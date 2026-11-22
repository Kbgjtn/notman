import type Gio from 'gi://Gio';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

/**
 * Stage 0 skeleton.
 *
 * The compatibility bridge, rule registry, engine, panel popover and D-Bus API
 * land in later stages. This file exists so the toolchain and settings schema
 * can be verified without touching a running shell.
 */
export default class NotmanExtension extends Extension {
  _settings?: Gio.Settings;

  enable(): void {
    this._settings = this.getSettings();
    // Stage 0: toolchain smoke only. No shell internals are touched.
  }

  disable(): void {
    this._settings = undefined;
  }
}
