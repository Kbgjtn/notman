// Global ambient declarations. This file intentionally has no top-level
// imports/exports so `declare module` creates an ambient module rather than a
// module augmentation.

// @girs/gnome-shell still declares the pre-45 resource path for prefs.
// GNOME 46 actually exposes it here (verified from the gnome-46 source tag).
declare module "resource:///org/gnome/shell/extensions/prefs.js" {
  export * from "@girs/gnome-shell/extensions/prefs";
}
