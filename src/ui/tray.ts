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
  private readonly _thumbnailMenu: PopupMenu.PopupSubMenuMenuItem;
  private readonly _statusSeparator: PopupMenu.PopupSeparatorMenuItem;
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
      _("Manage notifications"),
      SettingKey.GuardEnabled,
      () => this._settings.get_boolean(SettingKey.GuardEnabled),
      (value) => this._settings.set_boolean(SettingKey.GuardEnabled, value),
    );
    this._notifyItem = this.addSwitch(
      _("Screenshot notifications"),
      SettingKey.ScreenshotNotifyEnabled,
      () => this._settings.get_boolean(SettingKey.ScreenshotNotifyEnabled),
      (value) => this._settings.set_boolean(SettingKey.ScreenshotNotifyEnabled, value),
    );
    this._thumbnailMenu = this.addThumbnailModeMenu();

    this._statusSeparator = new PopupMenu.PopupSeparatorMenuItem("");
    menu.addMenuItem(this._statusSeparator);

    const prefsItem = new PopupMenu.PopupMenuItem(_("Preferences…"));
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
      this._icon.opacity = guardEnabled ? ICON_ACTIVE_OPACITY : ICON_PAUSED_OPACITY;
      this._notifyItem.setSensitive(guardEnabled);
      this._thumbnailMenu.setSensitive(guardEnabled && notifyEnabled);
      this.refreshStatus();
    };
    this.watchSetting(SettingKey.GuardEnabled, syncVisualState);
    this.watchSetting(SettingKey.ScreenshotNotifyEnabled, syncVisualState);
    syncVisualState();

    const openId = menu.connect("open-state-changed", (...args: unknown[]) => {
      if (args[1]) {
        this.refreshAll();
        this.startStatsTimer();
      } else {
        this.stopStatsTimer();
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

  private addThumbnailModeMenu(): PopupMenu.PopupSubMenuMenuItem {
    const submenu = new PopupMenu.PopupSubMenuMenuItem(_("Previews"));
    const choices: Array<{
      mode: ThumbnailMode;
      shortLabel: string;
      item: PopupMenu.PopupMenuItem;
    }> = [
      {
        mode: ThumbnailMode.Full,
        shortLabel: _("Full"),
        item: new PopupMenu.PopupMenuItem(_("Full size")),
      },
      {
        mode: ThumbnailMode.Compact,
        shortLabel: _("Compact"),
        item: new PopupMenu.PopupMenuItem(_("Compact")),
      },
      {
        mode: ThumbnailMode.TextOnly,
        shortLabel: _("Text only"),
        item: new PopupMenu.PopupMenuItem(_("Text only")),
      },
    ];

    for (const choice of choices) {
      choice.item.connect("activate", () => {
        try {
          this._settings.set_string(SettingKey.ScreenshotThumbnailMode, choice.mode);
        } catch (e) {
          log.err("tray", `could not update ${SettingKey.ScreenshotThumbnailMode}`, e);
        }
      });
      submenu.menu.addMenuItem(choice.item);
    }

    const refresh = (): void => {
      const current = parseThumbnailMode(
        this._settings.get_string(SettingKey.ScreenshotThumbnailMode),
      );
      let activeLabel = _("Full");
      for (const choice of choices) {
        const isCurrent = choice.mode === current;
        choice.item.setOrnament(isCurrent ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NONE);
        if (isCurrent) activeLabel = choice.shortLabel;
      }
      submenu.label.text = `${_("Previews")}: ${activeLabel}`;
    };

    refresh();
    this.watchSetting(SettingKey.ScreenshotThumbnailMode, refresh);
    this._indicator.menu.addMenuItem(submenu);
    return submenu;
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

  private refreshStatus(): void {
    if (!this._settings.get_boolean(SettingKey.GuardEnabled)) {
      this._statusSeparator.label.text = _("Paused");
      return;
    }
    const stats = this._engine.getStats();
    const parts = [`${stats.activeCount} ${_("active")}`];
    if (stats.estimatedBytes > 0) parts.push(formatBytes(stats.estimatedBytes));
    if (stats.prunedCount > 0) parts.push(`${stats.prunedCount} ${_("cleaned")}`);
    this._statusSeparator.label.text = parts.join(" · ");
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
