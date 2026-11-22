#!/usr/bin/env bash
# Isolated GNOME Shell QA: private Xvfb display + private session bus.
# All XDG dirs are set BEFORE dbus-run-session so dconf and other bus-activated
# services inherit them. Never touches the live session or its settings.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ "${NOTMAN_QA_INNER:-}" != "1" ]; then
  QA_TMP="$(mktemp -d "${TMPDIR:-/tmp}/notman-qa.XXXXXX")"
  export QA_TMP NOTMAN_QA_INNER=1
  export XDG_DATA_HOME="$QA_TMP/data"
  export XDG_CONFIG_HOME="$QA_TMP/config"
  export XDG_CACHE_HOME="$QA_TMP/cache"
  export XDG_RUNTIME_DIR="$QA_TMP/runtime"
  export XDG_CURRENT_DESKTOP=GNOME
  export XDG_PICTURES_DIR="$QA_TMP/pictures"
  export GSETTINGS_SCHEMA_DIR="$ROOT/dist/schemas"
  mkdir -p "$XDG_DATA_HOME/gnome-shell/extensions" "$XDG_RUNTIME_DIR" "$XDG_PICTURES_DIR"
  chmod 700 "$XDG_RUNTIME_DIR"
  ln -s "$ROOT/dist" "$XDG_DATA_HOME/gnome-shell/extensions/notman@ozy.local"
  exec dbus-run-session -- xvfb-run -a -s "-screen 0 1280x800x24" bash "$0"
fi

SHELL_PID=""
cleanup() {
  if [ -n "$SHELL_PID" ]; then
    kill "$SHELL_PID" 2>/dev/null || true
    wait "$SHELL_PID" 2>/dev/null || true
  fi
  fusermount3 -uz "$XDG_RUNTIME_DIR/doc" 2>/dev/null || true
  fusermount3 -uz "$XDG_RUNTIME_DIR/gvfs" 2>/dev/null || true
  rm -rf "$QA_TMP" 2>/dev/null || true
}
trap cleanup EXIT

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

for _ in $(seq 1 20); do
  if gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
      --method org.gnome.Shell.Extensions.GetExtensionInfo notman@ozy.local 2>/dev/null \
      | grep -q "notman@ozy.local"; then
    break
  fi
  sleep 1
done

# DND on keeps the transient notification; never write screenshots to disk.
gsettings set org.gnome.desktop.notifications show-banners false
gsettings set org.gnome.desktop.lockdown disable-save-to-disk true
gsettings set org.gnome.shell.extensions.notman debug-logging true
echo "dnd=$(gsettings get org.gnome.desktop.notifications show-banners) " \
     "save=$(gsettings get org.gnome.desktop.lockdown disable-save-to-disk)"

gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
  --method org.gnome.Shell.Extensions.EnableExtension notman@ozy.local

READY=0
for _ in $(seq 1 20); do
  if gdbus call --session --dest org.gnome.Shell.Extensions.Notman \
      --object-path /org/gnome/Shell/Extensions/Notman \
      --method org.gnome.Shell.Extensions.Notman.GetStats >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 1
done
if [ "$READY" -ne 1 ]; then
  echo "QA FAIL: extension D-Bus API did not appear" >&2
  gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
    --method org.gnome.Shell.Extensions.GetExtensionInfo notman@ozy.local || true
  exit 1
fi

echo "--- extension errors ---"
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
  --method org.gnome.Shell.Extensions.GetExtensionErrors notman@ozy.local

echo "--- stats before ---"
gdbus call --session --dest org.gnome.Shell.Extensions.Notman \
  --object-path /org/gnome/Shell/Extensions/Notman \
  --method org.gnome.Shell.Extensions.Notman.GetStats

xdotool key --clearmodifiers shift+Print
sleep 2

echo "--- stats after one screenshot ---"
STATS="$(gdbus call --session --dest org.gnome.Shell.Extensions.Notman \
  --object-path /org/gnome/Shell/Extensions/Notman \
  --method org.gnome.Shell.Extensions.Notman.GetStats)"
echo "$STATS"
echo "--- shell log notable ---"
grep -iE 'screenshot|notman|debug\(|info\(|warn\(|err\(' "$QA_TMP/shell.log" | tail -30 || true

COUNT="$(echo "$STATS" | grep -o "activeCount': <[0-9]*>" | grep -o '[0-9]*' || true)"
if [ "${COUNT:-0}" -gt 0 ]; then
  echo "QA OK: screenshot tracked (activeCount=$COUNT)"
else
  echo "QA FAIL: screenshot was not tracked (activeCount=${COUNT:-none})" >&2
  exit 1
fi

echo "--- compact thumbnail mode ---"
gdbus call --session --dest org.gnome.Shell.Extensions.Notman \
  --object-path /org/gnome/Shell/Extensions/Notman \
  --method org.gnome.Shell.Extensions.Notman.ClearScreenshots >/dev/null
gsettings set org.gnome.shell.extensions.notman screenshot-thumbnail-mode compact
sleep 1
xdotool key --clearmodifiers shift+Print
sleep 2

COMPACT_STATS="$(gdbus call --session --dest org.gnome.Shell.Extensions.Notman \
  --object-path /org/gnome/Shell/Extensions/Notman \
  --method org.gnome.Shell.Extensions.Notman.GetStats)"
echo "$COMPACT_STATS"

COMPACT_COUNT="$(echo "$COMPACT_STATS" | grep -o "activeCount': <[0-9]*>" | grep -o '[0-9]*' || true)"
COMPACT_BYTES="$(echo "$COMPACT_STATS" | sed -n "s/.*'estimatedBytes': <int64 \([0-9]*\)>.*/\1/p")"
if [ "${COMPACT_COUNT:-0}" -le 0 ]; then
  echo "QA FAIL: compact screenshot was not tracked (activeCount=${COMPACT_COUNT:-none})" >&2
  exit 1
fi
if [ "${COMPACT_BYTES:-0}" -le 0 ] || [ "${COMPACT_BYTES:-0}" -ge 100000 ]; then
  echo "QA FAIL: expected 0 < estimatedBytes < 100000 in compact mode (got ${COMPACT_BYTES:-none})" >&2
  grep -iE 'notman|compact|bridge' "$QA_TMP/shell.log" | tail -30 || true
  exit 1
fi
echo "QA OK: compact thumbnail tracked (activeCount=$COMPACT_COUNT, estimatedBytes=$COMPACT_BYTES)"

echo "--- transient DND expiry ---"
gdbus call --session --dest org.gnome.Shell.Extensions.Notman \
  --object-path /org/gnome/Shell/Extensions/Notman \
  --method org.gnome.Shell.Extensions.Notman.ClearScreenshots >/dev/null
gsettings set org.gnome.shell.extensions.notman transient-expire-enabled true
gsettings set org.gnome.shell.extensions.notman transient-expire-seconds 5
gsettings set org.gnome.shell.extensions.notman transient-dnd-only true
sleep 1

notify-send --hint=byte:transient:1 "Notman QA" "Transient DND test"
sleep 1
BEFORE_EXPIRE="$(gdbus call --session --dest org.gnome.Shell.Extensions.Notman \
  --object-path /org/gnome/Shell/Extensions/Notman \
  --method org.gnome.Shell.Extensions.Notman.GetStats)"
echo "before expiry: $BEFORE_EXPIRE"
BEFORE_COUNT="$(echo "$BEFORE_EXPIRE" | grep -o "activeCount': <[0-9]*>" | grep -o '[0-9]*' || true)"
if [ "${BEFORE_COUNT:-0}" -le 0 ]; then
  echo "QA FAIL: transient notification was not tracked (activeCount=${BEFORE_COUNT:-none})" >&2
  exit 1
fi

sleep 6
AFTER_EXPIRE="$(gdbus call --session --dest org.gnome.Shell.Extensions.Notman \
  --object-path /org/gnome/Shell/Extensions/Notman \
  --method org.gnome.Shell.Extensions.Notman.GetStats)"
echo "after expiry: $AFTER_EXPIRE"
AFTER_COUNT="$(echo "$AFTER_EXPIRE" | grep -o "activeCount': <[0-9]*>" | grep -o '[0-9]*' || true)"
if [ "${AFTER_COUNT:-1}" -ne 0 ]; then
  echo "QA FAIL: transient notification did not expire (activeCount=${AFTER_COUNT:-none})" >&2
  grep -iE 'notman|transient|bridge' "$QA_TMP/shell.log" | tail -30 || true
  exit 1
fi
echo "QA OK: transient notification tracked and expired under DND"

ERRORS="$(gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
  --method org.gnome.Shell.Extensions.GetExtensionErrors notman@ozy.local)"
echo "--- extension errors (final) ---"
echo "$ERRORS"
if [ "$ERRORS" != "(@as [],)" ]; then
  echo "QA FAIL: extension reported errors: $ERRORS" >&2
  exit 1
fi
