#!/usr/bin/env bash
# Shared helpers for the bounded benchmark harness. Never run this file directly.
set -uo pipefail

NT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$NT_DIR/.." && pwd)"

# The extension schema is not installed system-wide; point GSettings at the
# compiled copy in the repo so case settings can actually be applied.
if [ -f "$ROOT_DIR/dist/schemas/gschemas.compiled" ]; then
  export GSETTINGS_SCHEMA_DIR="$ROOT_DIR/dist/schemas"
else
  if [ ! -f "$ROOT_DIR/schemas/gschemas.compiled" ]; then
    glib-compile-schemas "$ROOT_DIR/schemas"
  fi
  export GSETTINGS_SCHEMA_DIR="$ROOT_DIR/schemas"
fi

SHELL_PID="$(pgrep -u "$(id -u)" -x gnome-shell | head -1 || true)"

if [ -z "$SHELL_PID" ]; then
  echo "gnome-shell not found" >&2
  exit 1
fi

declare -A NT_ORIG_SETTINGS=()
NT_ORIG_RESOLUTION=""
NT_OUTPUT=""

NT_SETTINGS_SCHEMA="org.gnome.shell.extensions.notman"
NT_DESKTOP_SCHEMA="org.gnome.desktop.notifications"
NT_LOCKDOWN_SCHEMA="org.gnome.desktop.lockdown"
NT_ORIG_LOCKDOWN=""
NT_SETTINGS_KEYS=(
  "guard-enabled"
  "screenshot-notify-enabled"
  "screenshot-thumbnail-mode"
  "screenshot-max-count"
  "screenshot-expire-seconds"
  "screenshot-memory-budget-mb"
  "emergency-hard-cap"
)

rss_kb() {
  awk '/^VmRSS:/ {print $2}' "/proc/$SHELL_PID/status"
}

save_gsettings() {
  local key
  for key in "${NT_SETTINGS_KEYS[@]}"; do
    NT_ORIG_SETTINGS["$key"]="$(gsettings get "$NT_SETTINGS_SCHEMA" "$key")"
  done
  NT_ORIG_SETTINGS["show-banners"]="$(gsettings get "$NT_DESKTOP_SCHEMA" show-banners)"
  NT_ORIG_LOCKDOWN="$(gsettings get "$NT_LOCKDOWN_SCHEMA" disable-save-to-disk)"
}

restore_gsettings() {
  local key
  for key in "${NT_SETTINGS_KEYS[@]}"; do
    if [ -n "${NT_ORIG_SETTINGS[$key]:-}" ]; then
      gsettings set "$NT_SETTINGS_SCHEMA" "$key" "${NT_ORIG_SETTINGS[$key]}" 2>/dev/null || true
    fi
  done
  if [ -n "${NT_ORIG_SETTINGS[show-banners]:-}" ]; then
    gsettings set "$NT_DESKTOP_SCHEMA" show-banners "${NT_ORIG_SETTINGS[show-banners]}" 2>/dev/null || true
  fi
  if [ -n "$NT_ORIG_LOCKDOWN" ]; then
    gsettings set "$NT_LOCKDOWN_SCHEMA" disable-save-to-disk "$NT_ORIG_LOCKDOWN" 2>/dev/null || true
  fi
}

set_case_settings() {
  local case="$1"
  # Never write screenshots into the user's Pictures directory. The shell still
  # creates the full-size thumbnail notification on this path.
  gsettings set "$NT_LOCKDOWN_SCHEMA" disable-save-to-disk true

  # Do Not Disturb on is the reported condition; only the control case turns it off.
  gsettings set "$NT_DESKTOP_SCHEMA" show-banners false
  case "$case" in
    leak|leak-dndoff)
      gsettings set "$NT_SETTINGS_SCHEMA" guard-enabled false
      ;;
    drop)
      gsettings set "$NT_SETTINGS_SCHEMA" guard-enabled true
      gsettings set "$NT_SETTINGS_SCHEMA" screenshot-notify-enabled false
      ;;
    text)
      gsettings set "$NT_SETTINGS_SCHEMA" guard-enabled true
      gsettings set "$NT_SETTINGS_SCHEMA" screenshot-thumbnail-mode "'text-only'"
      ;;
    limit)
      gsettings set "$NT_SETTINGS_SCHEMA" guard-enabled true
      gsettings set "$NT_SETTINGS_SCHEMA" screenshot-max-count 3
      ;;
    expire)
      gsettings set "$NT_SETTINGS_SCHEMA" guard-enabled true
      gsettings set "$NT_SETTINGS_SCHEMA" screenshot-expire-seconds 2
      ;;
    budget)
      gsettings set "$NT_SETTINGS_SCHEMA" guard-enabled true
      gsettings set "$NT_SETTINGS_SCHEMA" screenshot-memory-budget-mb 32
      ;;
    cap)
      gsettings set "$NT_SETTINGS_SCHEMA" guard-enabled true
      gsettings set "$NT_SETTINGS_SCHEMA" emergency-hard-cap 8
      ;;
    *)
      echo "unknown case: $case" >&2
      return 1
      ;;
  esac
  if [ "$case" = "leak-dndoff" ]; then
    gsettings set "$NT_DESKTOP_SCHEMA" show-banners true
  fi
}

primary_output() {
  xrandr --query 2>/dev/null | awk '/ connected primary / {print $1; exit}'
}

current_resolution() {
  xrandr --query 2>/dev/null | awk '/ connected primary / {print $4; exit}'
}

set_resolution() {
  local res="$1"
  NT_OUTPUT="$(primary_output)"
  if [ -z "$NT_OUTPUT" ]; then
    echo "no primary output found" >&2
    return 1
  fi
  NT_ORIG_RESOLUTION="$(current_resolution)"
  xrandr --output "$NT_OUTPUT" --mode "$res"
}

restore_resolution() {
  if [ -n "$NT_OUTPUT" ] && [ -n "$NT_ORIG_RESOLUTION" ]; then
    xrandr --output "$NT_OUTPUT" --mode "$NT_ORIG_RESOLUTION" 2>/dev/null || true
  fi
}

read_stats() {
  gdbus call --session \
    --dest org.gnome.Shell.Extensions.Notman \
    --object-path /org/gnome/Shell/Extensions/Notman \
    --method org.gnome.Shell.Extensions.Notman.GetStats 2>/dev/null \
    | python3 "$NT_DIR/stats.py" || true
}
