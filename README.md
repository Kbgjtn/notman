# Notman

A GNOME Shell extension that exposes and enforces notification-list policies GNOME
keeps hidden. Version 1 is scoped to **screenshot notifications**; the engine is
built as a rule registry so other sources can be added later.

## Why

On GNOME 46, every screenshot creates a **new** `MessageTray.Source` holding a
full-resolution `St.ImageContent` (~33 MB at 3840x2160). The notification is
`isTransient: true`, and GNOME only destroys transient notifications after a
banner has been shown and hidden. With Do Not Disturb enabled, banners are
suppressed, so those notifications are never destroyed — the list grows and the
shell's memory climbs until the desktop buffers and lags.

GNOME Settings exposes none of this: no per-source mute for shell-internal
sources, no retention limit, no expiry, no memory budget, no thumbnail control.

## Status

- **Stage 0** — repository scaffold, schema, build config and the bounded
  baseline harness. The extension skeleton does nothing yet.
- Engine, panel UI, preferences and D-Bus API are staged for later.

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
the types match the shell version in `metadata.json`. Both the 46 and 51
releases of `@girs/gnome-shell` still declare the pre-45 prefs resource path;
`src/types/resource-paths.d.ts` corrects it locally.

## Build and install

```sh
make             # compile TypeScript into dist/
make check       # schema + import pinning + typecheck + unit tests
make dev-install # symlink dist/ into ~/.local/share/gnome-shell/extensions/
gnome-extensions enable notman@ozy.local
```

On X11, reload with `Alt+F2` → `r`. If the shell UI becomes unusable,
`tools/rescue.sh` (planned) disables the extension over D-Bus without the UI.

## Compatibility

| GNOME      | Status                                                           | Tier             |
| ---------- | ---------------------------------------------------------------- | ---------------- |
| 46         | Target, verification pending                                     | 2 (full) planned |
| 45, 47, 48 | Upstream screenshot code confirmed similar; adapters not written | Unsupported yet  |
| < 45       | Legacy `imports.ui.*` API, different extension lifecycle         | Out of scope     |

A version is added to `metadata.json` only after its adapter is verified in a
real session. Major-only entries (e.g. `"46"`) cover patch releases.

## Baseline measurement

`tools/measure.sh` fires 10 `Shift+Print` screenshots on one pinned CPU under a
60-second timeout and records gnome-shell RSS per shot into `results/baseline.csv`.
It is deliberately bounded and must not be run unattended on a shared machine.

```sh
make baseline          # only after explicit approval
N=5 PIN_CPU=2 make baseline
```

## Layout

```
extension.ts, prefs.ts       thin compiled entry points
src/                          bridge, compat adapters, rules, engine, UI, D-Bus
schemas/                      GSettings schema
tools/measure.sh              bounded baseline/benchmark harness
dist/                         generated, gitignored
```
