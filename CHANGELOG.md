# Changelog

All notable changes to Notman are documented in this file.

## [0.1.0] - 2026-11-22

### Added

- **Screenshot notification management**: discard on arrival, max count cap, age-based auto-dismiss, estimated memory limit, and clear-on-panel-open.
- **Compact downscaled thumbnails**: off-thread PNG decoding and downscaling (~128 px, ~36 KB vs ~32 MiB at 4K) with burst backpressure limits, per-notification cancellation, and clean fallback to text-only.
- **Screencast notification toggle**: separate control for shell-internal screencast notifications (`screencast-recorded-symbolic`).
- **Global DND transient-notification expiry**: automatically cleans up short-lived notifications from other apps that linger during Do Not Disturb, while protecting critical, feedback, and currently shown notifications.
- **Global retention**: optional cross-app notification cap and age-based expiry.
- **Per-app burst limit & custom app rules**: collapse per-app notification bursts within a sliding window and define per-app mute, max count, or expiry overrides.
- **Scheduled Do Not Disturb (Quiet hours)**: automatically mute banners on a daily schedule while respecting manual DND state.
- **Import / Export settings**: save and restore Notman configuration as JSON from Preferences.
- **GNOME Shell 46, 47, and 48 support**: modular compatibility adapters including GNOME 48 `St.ImageContent.set_bytes(coglContext, ...)` handling.
- **Native UI**: tabbed libadwaita Preferences (`General`, `Captures`, `Limits`, `About`), top-bar quick menu with live adaptive-unit stats and configurable panel position/order, plus D-Bus inspection API.
- **Verification**: 105 unit tests, isolated Xvfb GNOME Shell smoke test, bounded benchmark harness, and GNOME 46/47/48 CI compatibility matrix.
