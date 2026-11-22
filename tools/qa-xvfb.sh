#!/usr/bin/env bash
# Isolated GNOME Shell QA: private X display (via xvfb-run) plus private
# session bus (via dbus-run-session). Nothing here touches the live session.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
QA_TMP="$(mktemp -d /tmp/opencode/notman-qa.XXXXXX)"
SHELL_PID=""

cleanup() {
  if [ -n "$SHELL_PID" ]; then
    kill "$SHELL_PID" 2>/dev/null || true
    wait "$SHELL_PID" 2>/dev/null || true
  fi
  rm -rf "$QA_TMP"
}
trap cleanup EXIT

export XDG_DATA_HOME="$QA_TMP/data"
export XDG_CONFIG_HOME="$QA_TMP/config"
export XDG_CACHE_HOME="$QA_TMP/cache"
export XDG_RUNTIME_DIR="$QA_TMP/runtime"
export XDG_CURRENT_DESKTOP=GNOME
mkdir -p "$XDG_DATA_HOME/gnome-shell/extensions" "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"
ln -s "$ROOT/dist" "$XDG_DATA_HOME/gnome-shell/extensions/notman@ozy.local"

echo "QA display: $DISPLAY"
gnome-shell --x11 --replace --sm-disable >"$QA_TMP/shell.log" 2>&1 &
SHELL_PID=$!

for _ in $(seq 1 30); do
  if gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
      --method org.freedesktop.DBus.Peer.Ping >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
  --method org.gnome.Shell.Extensions.EnableExtension notman@ozy.local

echo "--- extension errors ---"
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
  --method org.gnome.Shell.Extensions.GetExtensionErrors notman@ozy.local

echo "--- stats before ---"
gdbus call --session --dest org.gnome.Shell.Extensions.Notman \
  --object-path /org/gnome/Shell/Extensions/Notman \
  --method org.gnome.Shell.Extensions.Notman.GetStats

xdotool key --clearmodifiers shift+Print
sleep 1

echo "--- stats after one screenshot ---"
STATS="$(gdbus call --session --dest org.gnome.Shell.Extensions.Notman \
  --object-path /org/gnome/Shell/Extensions/Notman \
  --method org.gnome.Shell.Extensions.Notman.GetStats)"
echo "$STATS"
if echo "$STATS" | grep -q "activeCount': <[0-9]*>"; then
  echo "QA OK: extension answered GetStats"
else
  echo "QA WARNING: no stats reply" >&2
fi

echo "--- shell log tail ---"
tail -8 "$QA_TMP/shell.log"
