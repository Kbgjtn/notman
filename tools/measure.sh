#!/usr/bin/env bash
# Bounded baseline harness.
#
# Fires N screenshots through the GNOME 46 Shift+Print keybinding. That handler
# calls captureScreenshot() -> _storeScreenshot(), the same path that creates the
# full-resolution thumbnail notification. D-Bus org.gnome.Shell.Screenshot does
# NOT create this notification, so xdotool is required here.
#
# Bounded by design: one pinned CPU, a hard timeout, and a small N.
set -euo pipefail

N="${N:-10}"
PIN_CPU="${PIN_CPU:-2}"
TIMEOUT_S="${TIMEOUT_S:-60}"
SLEEP="${SLEEP:-0.4}"
OUT="${OUT:-results/baseline.csv}"
SHOT_DIR="${SHOT_DIR:-$HOME/Pictures/Screenshots}"

# Re-exec once under the pin + timeout so every child inherits both.
if [ -z "${_NT_PINNED:-}" ]; then
  export _NT_PINNED=1
  exec timeout "$TIMEOUT_S" taskset -c "$PIN_CPU" "$0" "$@"
fi

PID="$(pgrep -u "$(id -u)" -x gnome-shell | head -1 || true)"
if [ -z "$PID" ]; then
  echo "gnome-shell not found" >&2
  exit 1
fi

rss_kb() { awk '/^VmRSS:/ {print $2}' "/proc/$PID/status"; }
shot_count() { find "$SHOT_DIR" -maxdepth 1 -type f -name '*.png' 2>/dev/null | wc -l; }

mkdir -p "$(dirname "$OUT")"
{
  echo "# generated $(date -Is)"
  echo "# shell_pid=$PID n=$N pin_cpu=$PIN_CPU timeout_s=$TIMEOUT_S sleep=$SLEEP"
  echo "# keybinding=$(gsettings get org.gnome.shell.keybindings screenshot)"
  echo "# dnd_show_banners=$(gsettings get org.gnome.desktop.notifications show-banners)"
  echo "shot,rss_kb,delta_kb,shot_files"
} > "$OUT"

BASE_RSS="$(rss_kb)"
BASE_FILES="$(shot_count)"
echo "baseline rss=${BASE_RSS} kB, existing screenshots=${BASE_FILES}"

for ((i = 1; i <= N; i++)); do
  xdotool key --clearmodifiers shift+Print
  sleep "$SLEEP"
  RSS="$(rss_kb)"
  printf '%s,%s,%s,%s\n' "$i" "$RSS" "$((RSS - BASE_RSS))" "$(shot_count)" >> "$OUT"
done

echo "done. results -> $OUT"
awk -F, '$1 ~ /^[0-9]+$/ {if ($3 > max) max = $3} END {print "peak rss delta=" max " kB"}' "$OUT"
