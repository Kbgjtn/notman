import Clutter from "gi://Clutter";
import type Gio from "gi://Gio";
import GLib from "gi://GLib";
import St from "gi://St";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

import { formatBytes } from "../byte-estimate.js";
import type { Engine } from "../engine.js";
import { log } from "../log.js";
import { parseThumbnailMode, SettingKey } from "../settings.js";
import { type IndicatorPosition, type SignalEmitter, ThumbnailMode } from "../types.js";

type SwitchItem = SignalEmitter & {
  state: boolean;
  setToggleState(state: boolean): void;
  setSensitive(sensitive: boolean): void;
};

type Menu = SignalEmitter & {
  addMenuItem(item: unknown, position?: number): void;
};

type IndicatorButton = SignalEmitter & {
  menu: Menu;
  add_child(child: unknown): void;
  destroy(): void;
};

const STATS_INTERVAL_MS = 2000;
const ICON_ACTIVE_OPACITY = 255;
const ICON_PAUSED_OPACITY = 130;

/** Minimal, native GNOME Shell top-bar status indicator for Notman. */
export class TrayIndicator {
  private readonly _disposers: Array<() => void> = [];
  private readonly _refreshers: Array<() => void> = [];
  private readonly _indicator: IndicatorButton;
  private readonly _icon: St.Icon;
  private readonly _notifyItem: SwitchItem;
  private readonly _modeButtons: St.Button[] = [];
  private readonly _modeRow: PopupMenu.PopupBaseMenuItem;
  private readonly _statsRow: PopupMenu.PopupBaseMenuItem;
  private readonly _activeValue: St.Label;
  private readonly _cleanedValue: St.Label;
  private readonly _savedValue: St.Label;
  private _statsTimerId: number | null = null;
  private _disposed = false;

  private constructor(
    uuid: string,
    private readonly _settings: Gio.Settings,
    private readonly _engine: Engine,
    openPreferences: () => void,
    position: IndicatorPosition,
    index: number,
  ) {
    this._indicator = new PanelMenu.Button(0.5, _("Notman")) as unknown as IndicatorButton;
    this._icon = new St.Icon({
      icon_name: "screenshot-recorded-symbolic",
      style_class: "system-status-icon",
    });
    this._indicator.add_child(this._icon);
    Main.panel.addToStatusArea(uuid, this._indicator as never, index, position);

    const menu = this._indicator.menu;

    this.addSwitch(
      _("Enabled"),
      SettingKey.GuardEnabled,
      () => this._settings.get_boolean(SettingKey.GuardEnabled),
      (value) => this._settings.set_boolean(SettingKey.GuardEnabled, value),
    );
    this._notifyItem = this.addSwitch(
      _("Screenshots"),
      SettingKey.ScreenshotNotifyEnabled,
      () => this._settings.get_boolean(SettingKey.ScreenshotNotifyEnabled),
      (value) => this._settings.set_boolean(SettingKey.ScreenshotNotifyEnabled, value),
    );
    this._modeRow = this.addPreviewModeBar();

    const statsCard = this.addStatsCard();
    this._statsRow = statsCard.row;
    this._activeValue = statsCard.activeValue;
    this._cleanedValue = statsCard.cleanedValue;
    this._savedValue = statsCard.savedValue;

    menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    const prefsItem = new PopupMenu.PopupMenuItem(_("Settings"));
    prefsItem.connect("activate", () => {
      try {
        openPreferences();
      } catch (e) {
        log.err("tray", "could not open preferences", e);
      }
    });
    menu.addMenuItem(prefsItem);

    const syncVisualState = (): void => {
      const guardEnabled = this._settings.get_boolean(SettingKey.GuardEnabled);
      const notifyEnabled = this._settings.get_boolean(SettingKey.ScreenshotNotifyEnabled);
      const modeActive = guardEnabled && notifyEnabled;
      this._icon.opacity = guardEnabled ? ICON_ACTIVE_OPACITY : ICON_PAUSED_OPACITY;
      this._notifyItem.setSensitive(guardEnabled);
      this._modeRow.opacity = modeActive ? ICON_ACTIVE_OPACITY : ICON_PAUSED_OPACITY;
      for (const button of this._modeButtons) button.reactive = modeActive;
      this.refreshStatus();
    };
    this.watchSetting(SettingKey.GuardEnabled, syncVisualState);
    this.watchSetting(SettingKey.ScreenshotNotifyEnabled, syncVisualState);
    syncVisualState();

    const openId = menu.connect("open-state-changed", (...args: unknown[]) => {
      if (this._disposed) return;
      try {
        if (args[1]) {
          this.refreshAll();
          this.startStatsTimer();
        } else {
          this.stopStatsTimer();
        }
      } catch (e) {
        log.err("tray", "menu state handler failed", e);
      }
    });
    this._disposers.push(() => {
      try {
        menu.disconnect(openId);
      } catch {
        // Menu may already be gone.
      }
    });

    log.info("tray", "status indicator added");
  }

  static create(
    uuid: string,
    settings: Gio.Settings,
    engine: Engine,
    openPreferences: () => void,
    position: IndicatorPosition,
    index: number,
  ): TrayIndicator | null {
    try {
      return new TrayIndicator(uuid, settings, engine, openPreferences, position, index);
    } catch (e) {
      log.err("tray", "setup failed", e);
      return null;
    }
  }

  destroy(): void {
    if (this._disposed) return;
    this._disposed = true;
    this.stopStatsTimer();
    while (this._disposers.length > 0) {
      this._disposers.pop()?.();
    }
    try {
      this._indicator.destroy();
    } catch {
      // Panel may already be gone.
    }
  }

  private watchSetting(key: SettingKey, refresh: () => void): void {
    this._refreshers.push(refresh);
    const id = this._settings.connect(`changed::${key}`, () => {
      try {
        refresh();
      } catch (e) {
        log.err("tray", `refresh for ${key} failed`, e);
      }
    });
    this._disposers.push(() => {
      try {
        this._settings.disconnect(id);
      } catch {
        // Settings may already be gone.
      }
    });
  }

  private addPreviewModeBar(): PopupMenu.PopupBaseMenuItem {
    const row = new PopupMenu.PopupBaseMenuItem({
      reactive: false,
      can_focus: false,
    });
    row.setOrnament(PopupMenu.Ornament.HIDDEN);
    const box = new St.BoxLayout({
      x_expand: true,
      x_align: Clutter.ActorAlign.FILL,
      style_class: "notman-segmented",
      layout_manager: new Clutter.BoxLayout({ homogeneous: true, spacing: 0 }),
    });
    const choices: Array<{ mode: ThumbnailMode; button: St.Button }> = [
      { mode: ThumbnailMode.Full, button: this.makeModeButton(_("Full"), "notman-seg-btn-first") },
      { mode: ThumbnailMode.Compact, button: this.makeModeButton(_("Compact")) },
      {
        mode: ThumbnailMode.TextOnly,
        button: this.makeModeButton(_("Text"), "notman-seg-btn-last"),
      },
    ];

    for (const choice of choices) {
      choice.button.connect("clicked", () => {
        try {
          this._settings.set_string(SettingKey.ScreenshotThumbnailMode, choice.mode);
        } catch (e) {
          log.err("tray", `could not update ${SettingKey.ScreenshotThumbnailMode}`, e);
        }
      });
      this._modeButtons.push(choice.button);
      box.add_child(choice.button);
    }

    const refresh = (): void => {
      const current = parseThumbnailMode(
        this._settings.get_string(SettingKey.ScreenshotThumbnailMode),
      );
      for (const choice of choices) {
        choice.button.checked = choice.mode === current;
      }
    };

    refresh();
    this.watchSetting(SettingKey.ScreenshotThumbnailMode, refresh);
    row.add_child(box);
    this._indicator.menu.addMenuItem(row);
    return row;
  }

  private makeModeButton(label: string, extraClass?: string): St.Button {
    return new St.Button({
      label,
      toggle_mode: true,
      can_focus: true,
      x_expand: true,
      style_class: extraClass ? `notman-seg-btn ${extraClass}` : "notman-seg-btn",
    });
  }

  private addSwitch(
    title: string,
    key: SettingKey,
    read: () => boolean,
    write: (value: boolean) => void,
  ): SwitchItem {
    const item = new PopupMenu.PopupSwitchMenuItem(title, false) as unknown as SwitchItem;
    item.setToggleState(read());
    this.watchSetting(key, () => item.setToggleState(read()));
    item.connect("toggled", () => {
      try {
        write(item.state);
      } catch (e) {
        log.err("tray", `could not update ${key}`, e);
      }
    });
    this._indicator.menu.addMenuItem(item);
    return item;
  }

  private addStatsCard(): {
    row: PopupMenu.PopupBaseMenuItem;
    activeValue: St.Label;
    cleanedValue: St.Label;
    savedValue: St.Label;
  } {
    const row = new PopupMenu.PopupBaseMenuItem({
      reactive: false,
      can_focus: false,
    });
    row.setOrnament(PopupMenu.Ornament.HIDDEN);

    const card = new St.BoxLayout({
      x_expand: true,
      x_align: Clutter.ActorAlign.FILL,
      style_class: "notman-stats-card",
      layout_manager: new Clutter.BoxLayout({ homogeneous: true, spacing: 0 }),
    });

    const makeCol = (caption: string): St.Label => {
      const col = new St.BoxLayout({
        vertical: true,
        x_expand: true,
        x_align: Clutter.ActorAlign.CENTER,
        style_class: "notman-stat-col",
      });
      const value = new St.Label({
        text: "0",
        x_align: Clutter.ActorAlign.CENTER,
        style_class: "notman-stat-value",
      });
      const label = new St.Label({
        text: caption,
        x_align: Clutter.ActorAlign.CENTER,
        style_class: "notman-stat-label",
      });
      col.add_child(value);
      col.add_child(label);
      card.add_child(col);
      return value;
    };

    const activeValue = makeCol(_("Active"));
    const cleanedValue = makeCol(_("Cleaned"));
    const savedValue = makeCol(_("Saved"));

    row.add_child(card);
    this._indicator.menu.addMenuItem(row);
    return { row, activeValue, cleanedValue, savedValue };
  }

  private refreshStatus(): void {
    const guardEnabled = this._settings.get_boolean(SettingKey.GuardEnabled);
    this._statsRow.opacity = guardEnabled ? ICON_ACTIVE_OPACITY : ICON_PAUSED_OPACITY;
    if (!guardEnabled) {
      this._activeValue.text = "—";
      this._cleanedValue.text = "—";
      this._savedValue.text = _("Paused");
      return;
    }
    const stats = this._engine.getStats();
    this._activeValue.text = String(stats.activeCount);
    this._cleanedValue.text = String(stats.prunedCount);
    this._savedValue.text = stats.savedBytes > 0 ? formatBytes(stats.savedBytes) : "0 B";
  }

  private refreshAll(): void {
    for (const refresh of this._refreshers) {
      try {
        refresh();
      } catch (e) {
        log.err("tray", "refresh failed", e);
      }
    }
  }

  private startStatsTimer(): void {
    this.stopStatsTimer();
    this._statsTimerId = GLib.timeout_add(GLib.PRIORITY_LOW, STATS_INTERVAL_MS, () => {
      try {
        this.refreshStatus();
      } catch (e) {
        log.err("tray", "stats update failed", e);
      }
      return GLib.SOURCE_CONTINUE;
    });
  }

  private stopStatsTimer(): void {
    if (this._statsTimerId !== null) {
      GLib.source_remove(this._statsTimerId);
      this._statsTimerId = null;
    }
  }
}
