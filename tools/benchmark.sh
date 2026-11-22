#!/usr/bin/env bash
# Bounded, case-based benchmark. Every run is pinned to one CPU and timed.
# Requires explicit approval before execution; use `make benchmark CONFIRM=1 ...`.
set -euo pipefail

CASE="leak"
RES=""
RUNS=2
SHOTS=10
SLEEP=0.4
EXPIRE_PAUSE=3
PIN_CPU=2
TIMEOUT_S=90
CONFIRMED=0

while [ $# -gt 0 ]; do
  case "$1" in
    --case) CASE="$2"; shift 2 ;;
    --res) RES="$2"; shift 2 ;;
    --runs) RUNS="$2"; shift 2 ;;
    --shots) SHOTS="$2"; shift 2 ;;
    --pin) PIN_CPU="$2"; shift 2 ;;
    --timeout) TIMEOUT_S="$2"; shift 2 ;;
    --confirm) CONFIRMED=1; shift ;;
    --help)
      echo "usage: benchmark.sh --case CASE --res WxH --runs N --shots N [--pin CPU] [--timeout S] --confirm"
      echo "cases: leak, leak-dndoff, drop, text, limit, expire, budget, cap"
      exit 0
      ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [ "$CONFIRMED" -ne 1 ]; then
  echo "Refusing to run: pass --confirm (or use 'make benchmark CONFIRM=1 ...')" >&2
  exit 2
fi

if [ -z "${NT_BENCH_PINNED:-}" ]; then
  export NT_BENCH_PINNED=1
  export NT_PIN_CPU="$PIN_CPU"
  export NT_TIMEOUT="$TIMEOUT_S"
  exec timeout "$TIMEOUT_S" taskset -c "$PIN_CPU" "$0" "$@"
fi

NT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$NT_DIR/common.sh"

mkdir -p results

cleanup() {
  restore_gsettings
  restore_resolution
}
trap cleanup EXIT

save_gsettings
set_case_settings "$CASE"
if [ -n "$RES" ]; then
  set_resolution "$RES"
fi

echo "case=$CASE res=${RES:-native} runs=$RUNS shots=$SHOTS pin=$PIN_CPU timeout=${TIMEOUT_S}s"
echo "dnd_show_banners=$(gsettings get org.gnome.desktop.notifications show-banners)"

for ((run = 1; run <= RUNS; run++)); do
  OUT="results/${CASE}-${RES:-native}-${run}.csv"
  {
    echo "# case=$CASE res=${RES:-native} run=$run"
    echo "# shell_pid=$SHELL_PID pin=$PIN_CPU timeout=$TIMEOUT_S"
    echo "# dnd_show_banners=$(gsettings get org.gnome.desktop.notifications show-banners)"
    echo "# save_to_disk=false"
    printf '# settings='
    for key in "${NT_SETTINGS_KEYS[@]}"; do
      printf '%s=%s ' "$key" "$(gsettings get "$NT_SETTINGS_SCHEMA" "$key")"
    done
    echo
    echo "shot,rss_kb,delta_kb,active_count,estimated_bytes,pruned_count,shell_rss_bytes"
  } > "$OUT"

  BASE_RSS="$(rss_kb)"
  echo "run $run: baseline rss=${BASE_RSS} kB"

  for ((shot = 1; shot <= SHOTS; shot++)); do
    xdotool key --clearmodifiers shift+Print
    sleep "$SLEEP"
    RSS="$(rss_kb)"
    STATS="$(read_stats)"
    printf '%s,%s,%s,%s\n' "$shot" "$RSS" "$((RSS - BASE_RSS))" "$STATS" >> "$OUT"
  done

  if [ "$CASE" = "expire" ]; then
    sleep "$EXPIRE_PAUSE"
    printf 'after_pause,%s,%s,%s\n' \
      "$(rss_kb)" "$(( $(rss_kb) - BASE_RSS ))" "$(read_stats)" >> "$OUT"
  fi

  echo "run $run -> $OUT"
done
