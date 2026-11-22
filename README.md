# Notman

A GNOME Shell extension that exposes and enforces notification-list policies GNOME
keeps hidden. Version 1 is scoped to **screenshot notifications**; the engine is
built as a rule registry so other sources can be added later.

## Why

This is a measurable memory leak in GNOME Shell 46, not a problem with the
screenshot tool or the files on disk.

### Mechanism, verified against the GNOME 46 source

1. `js/ui/screenshot.js:2313-2322` turns each capture into an `St.ImageContent`
   holding `pixbuf.read_pixel_bytes()` at the image's full width × height in
   RGBA8888 — about 31.6 MiB for a 3840×2160 screenshot.
2. `js/ui/screenshot.js:2325-2366` creates a **new `MessageTray.Source` for every
   shot**, sets that content as the notification's `gicon`, marks the
   notification `isTransient: true`, and adds it to `Main.messageTray`.
3. `MAX_NOTIFICATIONS_PER_SOURCE = 3` (`js/ui/messageTray.js:28`) cannot help:
   the cap is per source, and there is one source per image, so the list is
   effectively unbounded.
4. The only place transient notifications are destroyed is
   `MessageTray._hideNotificationCompleted()` (`js/ui/messageTray.js:1257-1258`),
   which runs only after a banner has been shown and hidden.
5. With Do Not Disturb enabled, `_onNotificationRequestBanner()` returns early
   for non-critical notifications (`js/ui/messageTray.js:914`). No banner is ever
   shown, so step 4 never runs and every full-size thumbnail is retained for the
   lifetime of the shell session.

### Measured proof

Baseline on this machine (X11, GNOME Shell 46.0, DND on, 10 × `Shift+Print`,
pinned to one CPU with `taskset`, bounded by `timeout 60s`, screenshot saving
disabled for the run):

| Measurement                          | gnome-shell RSS |
| ------------------------------------ | --------------- |
| Before                               | 656,484 kB      |
| After 10 screenshots                 | 1,096,748 kB    |
| Growth                               | **+440,264 kB** |
| Average per shot after the first one | ~45,700 kB      |

Raw per-shot samples are in `results/baseline.csv`. The growth is linear in the
number of screenshots, and no screenshot files were written at all — disk
output cannot explain the memory increase.

### Why GNOME Settings cannot fix it

GNOME Settings gives you a Do Not Disturb switch, a lock-screen switch and a
handful of per-application options, but none of them can stop this particular
notification. The screenshot notification is created by the shell itself rather
than by an installed application, so it never appears in the application list
where you would normally mute it. Its underlying policy is hard-coded to stay
enabled (`js/ui/messageTray.js:187-189`), and GNOME provides no setting for how
many notifications to keep, how long to keep them, how much memory they may use
or whether to keep the full-size thumbnail. The standard desktop notification
bus also has no way to list or close notifications created by another program.
Notman fills that gap by applying those rules at the exact moment the
notification is created, before the full-size image is retained.

## Requirements

- GNOME Shell 46 (pinned in `metadata.json`)
- X11 session for the fast `Alt+F2` → `r` development loop
- Node/npm **only at build time** — the installed extension is plain JS

> Toolchain note: this machine has no system Node. A local Node 24 tarball was
> unpacked into `/tmp/opencode/node` (no system changes). Prefix build commands
> with `export PATH=/tmp/opencode/node/bin:$PATH`. The harness in
> `tools/measure.sh` needs no Node.

## Dependencies

Pinned to versions with a clean audit and no deprecation warnings: TypeScript 7,
Vitest 5, Biome 2 and `@girs/gnome-shell` 46.x. The `@girs` packages are
intentionally held at GNOME 46 definitions even though newer majors exist, so
the types match the shell version in `metadata.json`. The preferences module is
imported from `resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js`,
the path that exists in the compiled shell resources.

## Build and install

```sh
make             # compile TypeScript into dist/
make check       # schema, imports, scripts, lint, unit tests, typecheck
make qa-xvfb     # isolated GNOME Shell 46 smoke test (private Xvfb + D-Bus)
make dev-install # symlink dist/ into ~/.local/share/gnome-shell/extensions/
gnome-extensions enable notman@ozy.local
```

On X11, reload with `Alt+F2` → `r` (on Wayland, log out and back in). If the
shell UI becomes unusable, the extension can be disabled over D-Bus without it:

```sh
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
  --method org.gnome.Shell.Extensions.DisableExtension notman@ozy.local
```

## Compatibility

| GNOME      | Adapter | Notes                                                          |
| ---------- | ------- | -------------------------------------------------------------- |
| 46         | `v46`   | Target; upstream notification path verified against source     |
| 45, 47, 48 | none    | Upstream screenshot notification code is effectively identical |
| < 45       | none    | Legacy `imports.ui.*` API, different extension lifecycle       |

A version is added to `metadata.json` only when an adapter for it exists.
Major-only entries (e.g. `"46"`) cover patch releases.

## Measurement

`tools/measure.sh` fires 10 `Shift+Print` screenshots on one pinned CPU under a
60-second timeout and records gnome-shell RSS per shot in `results/baseline.csv`.

`tools/benchmark.sh` repeats that for a named case and screen resolution,
sampling both RSS and the extension's D-Bus statistics. Screenshot saving is
disabled for the duration of a run, so your Pictures directory is not touched;
the shell still creates the notification and its full-size thumbnail. All
settings, display mode and refresh rate are restored on exit. Cases are `leak`
(reference, guard off), `leak-dndoff` and `text-dndoff` (controls), `drop`,
`text`, `limit`, `expire`, `budget`, `cap`, `combined` (all defaults at once)
and `unlimited` (no limits). The DND-off cases are controls only: banners add
compositor noise and the three-entry banner queue still leaks the overflow, so
they are not the comparison baseline. Runs must be approved before execution.

```sh
make baseline
make benchmark CONFIRM=1 CASE=limit RES=1920x1080 RUNS=2
make report   # writes results/report.md
```

`results/report.md` aggregates every run. Notification counts and estimated
thumbnail bytes are deterministic; RSS deltas are noisy because changing screen
resolution and GLib GC affect the shell's baseline between runs.

## Layout

```
extension.ts, prefs.ts       entry points (shell lifecycle and GTK4/Adw prefs)
src/                          bridge, compat adapters, rules, engine, tray UI, D-Bus
schemas/                      GSettings schema
tests/                        Vitest unit tests
tools/                        isolated Xvfb QA and bounded benchmark harness
dist/                         generated, gitignored
```
