#!/usr/bin/env bash
# Shared helpers for the bounded benchmark harness. Never run this file directly.
set -uo pipefail

NOTMAN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$NOTMAN_DIR/.." && pwd)"

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

declare -A NOTMAN_ORIG_SETTINGS=()
NOTMAN_ORIG_RESOLUTION=""
NOTMAN_ORIG_RATE=""
NOTMAN_OUTPUT=""

NOTMAN_SETTINGS_SCHEMA="org.gnome.shell.extensions.notman"
NOTMAN_DESKTOP_SCHEMA="org.gnome.desktop.notifications"
NOTMAN_LOCKDOWN_SCHEMA="org.gnome.desktop.lockdown"
NOTMAN_ORIG_LOCKDOWN=""
NOTMAN_SETTINGS_KEYS=(
  "guard-enabled"
  "screenshot-notify-enabled"
  "screencast-notify-enabled"
  "screenshot-thumbnail-mode"
  "screenshot-max-count"
  "screenshot-expire-seconds"
  "screenshot-memory-budget-mb"
  "emergency-hard-cap"
  "transient-expire-enabled"
  "transient-expire-seconds"
  "transient-dnd-only"
  "global-expire-minutes"
  "global-max-count"
  "burst-limit-enabled"
  "burst-window-seconds"
  "burst-max-per-source"
  "app-rules"
  "quiet-hours-enabled"
  "quiet-hours-start"
  "quiet-hours-end"
  "show-indicator"
  "indicator-position"
  "indicator-index"
  "clear-on-panel-open"
  "debug-logging"
)

rss_kb() {
  awk '/^VmRSS:/ {print $2}' "/proc/$SHELL_PID/status"
}

save_gsettings() {
  local key
  for key in "${NOTMAN_SETTINGS_KEYS[@]}"; do
    NOTMAN_ORIG_SETTINGS["$key"]="$(gsettings get "$NOTMAN_SETTINGS_SCHEMA" "$key")"
  done
  NOTMAN_ORIG_SETTINGS["show-banners"]="$(gsettings get "$NOTMAN_DESKTOP_SCHEMA" show-banners)"
  NOTMAN_ORIG_LOCKDOWN="$(gsettings get "$NOTMAN_LOCKDOWN_SCHEMA" disable-save-to-disk)"
}

restore_gsettings() {
  local key
  for key in "${NOTMAN_SETTINGS_KEYS[@]}"; do
    if [ -n "${NOTMAN_ORIG_SETTINGS[$key]:-}" ]; then
      gsettings set "$NOTMAN_SETTINGS_SCHEMA" "$key" "${NOTMAN_ORIG_SETTINGS[$key]}" 2>/dev/null || true
    fi
  done
  if [ -n "${NOTMAN_ORIG_SETTINGS[show-banners]:-}" ]; then
    gsettings set "$NOTMAN_DESKTOP_SCHEMA" show-banners "${NOTMAN_ORIG_SETTINGS[show-banners]}" 2>/dev/null || true
  fi
  if [ -n "$NOTMAN_ORIG_LOCKDOWN" ]; then
    gsettings set "$NOTMAN_LOCKDOWN_SCHEMA" disable-save-to-disk "$NOTMAN_ORIG_LOCKDOWN" 2>/dev/null || true
  fi
}

set_case_settings() {
  local case="$1"
  # Never write screenshots into the user's Pictures directory. The shell still
  # creates the full-size thumbnail notification on this path.
  gsettings set "$NOTMAN_LOCKDOWN_SCHEMA" disable-save-to-disk true

  # Do Not Disturb on is the reported condition; only the control case turns it off.
  gsettings set "$NOTMAN_DESKTOP_SCHEMA" show-banners false
  case "$case" in
    leak|leak-dndoff)
      gsettings set "$NOTMAN_SETTINGS_SCHEMA" guard-enabled false
      ;;
    drop)
      gsettings set "$NOTMAN_SETTINGS_SCHEMA" guard-enabled true
      gsettings set "$NOTMAN_SETTINGS_SCHEMA" screenshot-notify-enabled false
      ;;
    compact)
      gsettings set "$NOTMAN_SETTINGS_SCHEMA" guard-enabled true
      gsettings set "$NOTMAN_SETTINGS_SCHEMA" screenshot-thumbnail-mode "'compact'"
      ;;
    text)
      gsettings set "$NOTMAN_SETTINGS_SCHEMA" guard-enabled true
      gsettings set "$NOTMAN_SETTINGS_SCHEMA" screenshot-thumbnail-mode "'text-only'"
      ;;
    limit)
      gsettings set "$NOTMAN_SETTINGS_SCHEMA" guard-enabled true
      gsettings set "$NOTMAN_SETTINGS_SCHEMA" screenshot-max-count 3
      ;;
    expire)
      gsettings set "$NOTMAN_SETTINGS_SCHEMA" guard-enabled true
      gsettings set "$NOTMAN_SETTINGS_SCHEMA" screenshot-expire-seconds 2
      ;;
    budget)
      gsettings set "$NOTMAN_SETTINGS_SCHEMA" guard-enabled true
      gsettings set "$NOTMAN_SETTINGS_SCHEMA" screenshot-memory-budget-mb 32
      ;;
    cap)
      gsettings set "$NOTMAN_SETTINGS_SCHEMA" guard-enabled true
      gsettings set "$NOTMAN_SETTINGS_SCHEMA" screenshot-max-count 0
      gsettings set "$NOTMAN_SETTINGS_SCHEMA" screenshot-expire-seconds 0
      gsettings set "$NOTMAN_SETTINGS_SCHEMA" screenshot-memory-budget-mb 0
      gsettings set "$NOTMAN_SETTINGS_SCHEMA" emergency-hard-cap 8
      ;;
    combined)
      gsettings set "$NOTMAN_SETTINGS_SCHEMA" guard-enabled true
      gsettings set "$NOTMAN_SETTINGS_SCHEMA" screenshot-max-count 3
      gsettings set "$NOTMAN_SETTINGS_SCHEMA" screenshot-expire-seconds 15
      gsettings set "$NOTMAN_SETTINGS_SCHEMA" screenshot-memory-budget-mb 64
      gsettings set "$NOTMAN_SETTINGS_SCHEMA" emergency-hard-cap 64
      ;;
    unlimited)
      gsettings set "$NOTMAN_SETTINGS_SCHEMA" guard-enabled true
      gsettings set "$NOTMAN_SETTINGS_SCHEMA" screenshot-max-count 0
      gsettings set "$NOTMAN_SETTINGS_SCHEMA" screenshot-expire-seconds 0
      gsettings set "$NOTMAN_SETTINGS_SCHEMA" screenshot-memory-budget-mb 0
      gsettings set "$NOTMAN_SETTINGS_SCHEMA" emergency-hard-cap 0
      ;;
    text-dndoff)
      gsettings set "$NOTMAN_SETTINGS_SCHEMA" guard-enabled true
      gsettings set "$NOTMAN_SETTINGS_SCHEMA" screenshot-thumbnail-mode "'text-only'"
      ;;
    *)
      echo "unknown case: $case" >&2
      return 1
      ;;
  esac
  case "$case" in
    leak-dndoff|text-dndoff)
      gsettings set "$NOTMAN_DESKTOP_SCHEMA" show-banners true
      ;;
  esac
}

primary_output() {
  xrandr --query 2>/dev/null | awk '/ connected primary / {print $1; exit}'
}

current_resolution() {
  xrandr --query 2>/dev/null | awk '/ connected primary / {sub(/\+.*/, "", $4); print $4; exit}'
}

current_rate() {
  xrandr --query 2>/dev/null | awk -v out="$NOTMAN_OUTPUT" '
    $0 ~ "^" out " connected" { inout = 1; next }
    inout && /^[[:space:]]+[0-9]+x[0-9]+/ {
      for (i = 1; i <= NF; i++) {
        if ($i ~ /\*/) { gsub(/\*.*/, "", $i); print $i; exit }
      }
    }
    inout && /^[^[:space:]]/ { exit }
  '
}

set_resolution() {
  local res="$1"
  NOTMAN_OUTPUT="$(primary_output)"
  if [ -z "$NOTMAN_OUTPUT" ]; then
    echo "no primary output found" >&2
    return 1
  fi
  NOTMAN_ORIG_RESOLUTION="$(current_resolution)"
  NOTMAN_ORIG_RATE="$(current_rate)"
  xrandr --output "$NOTMAN_OUTPUT" --mode "$res"
}

restore_resolution() {
  if [ -n "$NOTMAN_OUTPUT" ] && [ -n "$NOTMAN_ORIG_RESOLUTION" ]; then
    if [ -n "$NOTMAN_ORIG_RATE" ]; then
      xrandr --output "$NOTMAN_OUTPUT" --mode "$NOTMAN_ORIG_RESOLUTION" --rate "$NOTMAN_ORIG_RATE" 2>/dev/null || true
    else
      xrandr --output "$NOTMAN_OUTPUT" --mode "$NOTMAN_ORIG_RESOLUTION" 2>/dev/null || true
    fi
  fi
}

read_stats() {
  gdbus call --session \
    --dest org.gnome.Shell.Extensions.Notman \
    --object-path /org/gnome/Shell/Extensions/Notman \
    --method org.gnome.Shell.Extensions.Notman.GetStats 2>/dev/null \
    | python3 "$NOTMAN_DIR/stats.py" || true
}
