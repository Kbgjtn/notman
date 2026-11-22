import Adw from "gi://Adw";
import Gdk from "gi://Gdk";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Gtk from "gi://Gtk";
import {
  gettext as _,
  ExtensionPreferences,
} from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

import { formatBytes } from "./src/byte-estimate.js";
import { DBUS_BUS_NAME, DBUS_OBJECT_PATH, DbusMethod } from "./src/dbus.js";
import { parseIndicatorPosition, parseThumbnailMode, SettingKey } from "./src/settings.js";
import { IndicatorPosition, ThumbnailMode } from "./src/types.js";

const PREFS_CSS = `
.notman-mode-frame {
  border-radius: 12px;
  border: 1px solid alpha(@window_fg_color, 0.14);
  background-color: @card_bg_color;
  padding: 6px;
}
.notman-mode-card {
  border-radius: 9px;
  padding: 12px 10px;
  border: 1px solid transparent;
  background-color: transparent;
}
.notman-mode-card:hover {
  background-color: alpha(@window_fg_color, 0.05);
}
.notman-mode-card:checked {
  background-color: alpha(@accent_bg_color, 0.16);
  border-color: @accent_bg_color;
}
.notman-stat-card {
  border-radius: 12px;
  border: 1px solid alpha(@window_fg_color, 0.1);
  background-color: @card_bg_color;
  padding: 14px 10px;
}
.notman-stat-active {
  background-color: rgba(56, 189, 248, 0.1);
  border-color: rgba(56, 189, 248, 0.28);
}
.notman-stat-active .notman-stat-accent {
  color: #38bdf8;
}
.notman-stat-cleaned {
  background-color: rgba(251, 191, 36, 0.1);
  border-color: rgba(251, 191, 36, 0.28);
}
.notman-stat-cleaned .notman-stat-accent {
  color: #fbbf24;
}
.notman-stat-saved {
  background-color: rgba(52, 211, 153, 0.1);
  border-color: rgba(52, 211, 153, 0.28);
}
.notman-stat-saved .notman-stat-accent {
  color: #34d399;
}
`;

interface LiveStats {
  readonly activeCount: number;
  readonly estimatedBytes: number;
  readonly peakBytes: number;
  readonly prunedCount: number;
  readonly savedBytes: number;
}

function fetchStatsAsync(callback: (stats: LiveStats | null) => void): void {
  Gio.DBus.session.call(
    DBUS_BUS_NAME,
    DBUS_OBJECT_PATH,
    DBUS_BUS_NAME,
    DbusMethod.GetStats,
    null,
    null,
    Gio.DBusCallFlags.NONE,
    500,
    null,
    (connection, result) => {
      try {
        const reply = connection?.call_finish(result);
        if (!reply) {
          callback(null);
          return;
        }
        const [dict] = reply.deepUnpack() as [Record<string, GLib.Variant>];
        callback({
          activeCount: dict.activeCount.get_int32(),
          estimatedBytes: Number(dict.estimatedBytes.get_int64()),
          peakBytes: Number(dict.peakBytes.get_int64()),
          prunedCount: dict.prunedCount.get_int32(),
          savedBytes: dict.savedBytes ? Number(dict.savedBytes.get_int64()) : 0,
        });
      } catch {
        callback(null);
      }
    },
  );
}

function openExternalUri(uri: string): void {
  try {
    Gio.AppInfo.launch_default_for_uri(uri, null);
  } catch {
    // Ignore if no URI handler is registered in this environment.
  }
}

export default class NotmanPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window: Adw.PreferencesWindow): void {
    window.search_enabled = true;
    window.set_default_size(680, 720);

    const display = Gdk.Display.get_default();
    let cssProvider: Gtk.CssProvider | null = null;
    if (display) {
      cssProvider = new Gtk.CssProvider();
      cssProvider.load_from_string(PREFS_CSS);
      Gtk.StyleContext.add_provider_for_display(
        display,
        cssProvider,
        Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION,
      );
    }

    const settings = this.getSettings();
    const bindings: Array<{ target: unknown; property: string }> = [];
    const signalIds: number[] = [];
    let statsTimerId: number | null = null;
    let disposed = false;

    const bind = (
      key: SettingKey,
      target: unknown,
      property: string,
      flags = Gio.SettingsBindFlags.DEFAULT,
    ): void => {
      settings.bind(key, target as never, property, flags);
      bindings.push({ target, property });
    };

    const addHeaderSwitch = (group: Adw.PreferencesGroup, key: SettingKey): Gtk.Switch => {
      const toggle = new Gtk.Switch({ valign: Gtk.Align.CENTER });
      bind(key, toggle, "active");
      group.set_header_suffix(toggle);
      return toggle;
    };

    const addSwitch = (
      group: Adw.PreferencesGroup,
      key: SettingKey,
      title: string,
      subtitle: string,
    ): Adw.SwitchRow => {
      const row = new Adw.SwitchRow({ title, subtitle });
      bind(key, row, "active");
      group.add(row);
      return row;
    };

    const addSpin = (
      group: Adw.PreferencesGroup,
      key: SettingKey,
      title: string,
      subtitle: string,
      lower: number,
      upper: number,
      step: number,
    ): Adw.SpinRow => {
      const adjustment = new Gtk.Adjustment({
        lower,
        upper,
        step_increment: step,
        value: settings.get_int(key),
      });
      const row = new Adw.SpinRow({ title, subtitle, adjustment });
      bind(key, row, "value");
      group.add(row);
      return row;
    };

    const addSlider = (
      group: Adw.PreferencesGroup,
      key: SettingKey,
      title: string,
      subtitle: string,
      lower: number,
      upper: number,
      step: number,
    ): Adw.ActionRow => {
      const adjustment = new Gtk.Adjustment({
        lower,
        upper,
        step_increment: step,
        page_increment: step * 2,
        value: settings.get_int(key),
      });
      bind(key, adjustment, "value");
      const scale = new Gtk.Scale({
        orientation: Gtk.Orientation.HORIZONTAL,
        adjustment,
        draw_value: true,
        value_pos: Gtk.PositionType.TOP,
        digits: 0,
        round_digits: 0,
        width_request: 180,
        valign: Gtk.Align.CENTER,
      });
      const row = new Adw.ActionRow({ title, subtitle });
      row.add_suffix(scale);
      group.add(row);
      return row;
    };

    const addLinkRow = (group: Adw.PreferencesGroup, title: string, uri: string): void => {
      const row = new Adw.ActionRow({ title, activatable: true });
      row.add_suffix(new Gtk.Image({ icon_name: "go-next-symbolic" }));
      row.connect("activated", () => openExternalUri(uri));
      group.add(row);
    };

    const generalPage = new Adw.PreferencesPage({
      title: _("General"),
      icon_name: "emblem-system-symbolic",
    });

    const statusGroup = new Adw.PreferencesGroup({
      title: _("Status"),
    });
    const statsGrid = new Gtk.Box({
      orientation: Gtk.Orientation.HORIZONTAL,
      homogeneous: true,
      spacing: 10,
    });
    const makeStatTile = (caption: string, iconName: string, toneClass: string): Gtk.Label => {
      const tile = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 6,
        css_classes: ["notman-stat-card", toneClass],
      });
      const value = new Gtk.Label({
        label: "—",
        css_classes: ["title-2", "notman-stat-accent"],
      });
      const footer = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 4,
        halign: Gtk.Align.CENTER,
      });
      footer.append(
        new Gtk.Image({
          icon_name: iconName,
          pixel_size: 13,
          css_classes: ["notman-stat-accent"],
        }),
      );
      footer.append(
        new Gtk.Label({
          label: caption,
          css_classes: ["caption", "dim-label"],
        }),
      );
      tile.append(value);
      tile.append(footer);
      statsGrid.append(tile);
      return value;
    };
    const activeVal = makeStatTile(_("Active"), "go-up-symbolic", "notman-stat-active");
    const cleanedVal = makeStatTile(_("Cleaned"), "go-down-symbolic", "notman-stat-cleaned");
    const savedVal = makeStatTile(_("RAM saved"), "emblem-ok-symbolic", "notman-stat-saved");
    statusGroup.add(statsGrid);
    generalPage.add(statusGroup);

    const refreshStatus = (): void => {
      fetchStatsAsync((stats) => {
        if (disposed) return;
        if (!stats) {
          statusGroup.description = _(
            "Notman isn't running right now. Enable the extension or reload GNOME Shell.",
          );
          activeVal.label = "—";
          cleanedVal.label = "—";
          savedVal.label = "—";
          return;
        }
        statusGroup.description =
          stats.estimatedBytes > 0
            ? `${_("Current previews")}: ${formatBytes(stats.estimatedBytes)}`
            : "";
        activeVal.label = String(stats.activeCount);
        cleanedVal.label = String(stats.prunedCount);
        savedVal.label = stats.savedBytes > 0 ? formatBytes(stats.savedBytes) : "0 B";
      });
    };
    refreshStatus();
    statsTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
      refreshStatus();
      return GLib.SOURCE_CONTINUE;
    });

    const generalGroup = new Adw.PreferencesGroup({
      title: _("General"),
    });
    addSwitch(generalGroup, SettingKey.GuardEnabled, _("Enabled"), _("Turn off to pause Notman."));
    addSwitch(
      generalGroup,
      SettingKey.ClearOnPanelOpen,
      _("Clear on panel open"),
      _("Clear screenshots when you open the notification list."),
    );
    generalPage.add(generalGroup);

    const topBarGroup = new Adw.PreferencesGroup({
      title: _("Tray"),
      description: _("Quick menu and live status in the top bar."),
    });
    addHeaderSwitch(topBarGroup, SettingKey.ShowIndicator);

    const positionRow = new Adw.ActionRow({
      title: _("Position"),
      subtitle: _("Side of the top bar."),
    });
    const positionBox = new Gtk.Box({
      orientation: Gtk.Orientation.HORIZONTAL,
      valign: Gtk.Align.CENTER,
      css_classes: ["linked"],
    });
    const positionChoices: Array<{ pos: IndicatorPosition; label: string }> = [
      { pos: IndicatorPosition.Left, label: _("Left") },
      { pos: IndicatorPosition.Center, label: _("Center") },
      { pos: IndicatorPosition.Right, label: _("Right") },
    ];
    const positionButtons = new Map<IndicatorPosition, Gtk.ToggleButton>();
    let firstPositionButton: Gtk.ToggleButton | null = null;
    for (const choice of positionChoices) {
      const btn = new Gtk.ToggleButton({ label: choice.label });
      if (firstPositionButton) {
        btn.set_group(firstPositionButton);
      } else {
        firstPositionButton = btn;
      }
      btn.connect("toggled", () => {
        if (btn.active) {
          settings.set_string(SettingKey.IndicatorPosition, choice.pos);
        }
      });
      positionButtons.set(choice.pos, btn);
      positionBox.append(btn);
    }
    const syncPositionButtons = (): void => {
      const current = parseIndicatorPosition(settings.get_string(SettingKey.IndicatorPosition));
      const target = positionButtons.get(current);
      if (target && !target.active) target.active = true;
    };
    syncPositionButtons();
    signalIds.push(
      settings.connect(`changed::${SettingKey.IndicatorPosition}`, syncPositionButtons),
    );
    positionRow.add_suffix(positionBox);
    topBarGroup.add(positionRow);

    const indexRow = addSpin(
      topBarGroup,
      SettingKey.IndicatorIndex,
      _("Order"),
      _("Placement inside that side."),
      0,
      20,
      1,
    );
    for (const dependentRow of [positionRow, indexRow]) {
      bind(SettingKey.ShowIndicator, dependentRow, "sensitive", Gio.SettingsBindFlags.GET);
    }
    generalPage.add(topBarGroup);

    const screenshotsPage = new Adw.PreferencesPage({
      title: _("Captures"),
      icon_name: "camera-photo-symbolic",
    });

    const rulesGroup = new Adw.PreferencesGroup({
      title: _("Screenshots"),
      description: _("How screenshot alerts are kept. Set 0 to disable a limit."),
    });
    bind(SettingKey.GuardEnabled, rulesGroup, "sensitive", Gio.SettingsBindFlags.GET);
    addHeaderSwitch(rulesGroup, SettingKey.ScreenshotNotifyEnabled);

    const modeFrame = new Gtk.Box({
      orientation: Gtk.Orientation.HORIZONTAL,
      homogeneous: true,
      spacing: 6,
      margin_bottom: 12,
      css_classes: ["notman-mode-frame"],
    });
    const modeOptions: Array<{
      mode: ThumbnailMode;
      icon: string;
      title: string;
      subtitle: string;
    }> = [
      {
        mode: ThumbnailMode.Full,
        icon: "camera-photo-symbolic",
        title: _("Full size"),
        subtitle: _("Original image (~32 MiB at 4K)"),
      },
      {
        mode: ThumbnailMode.Compact,
        icon: "view-grid-symbolic",
        title: _("Compact"),
        subtitle: _("Small preview (~36 KB)"),
      },
      {
        mode: ThumbnailMode.TextOnly,
        icon: "text-x-generic-symbolic",
        title: _("Text only"),
        subtitle: _("No image preview"),
      },
    ];

    const modeButtons = new Map<ThumbnailMode, Gtk.ToggleButton>();
    let firstModeButton: Gtk.ToggleButton | null = null;
    for (const opt of modeOptions) {
      const card = new Gtk.ToggleButton({
        css_classes: ["flat", "notman-mode-card"],
        hexpand: true,
      });
      if (firstModeButton) {
        card.set_group(firstModeButton);
      } else {
        firstModeButton = card;
      }

      const content = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 6,
        halign: Gtk.Align.FILL,
      });
      content.append(
        new Gtk.Image({
          icon_name: opt.icon,
          pixel_size: 28,
          halign: Gtk.Align.START,
          margin_bottom: 4,
        }),
      );
      content.append(
        new Gtk.Label({
          label: opt.title,
          xalign: 0,
          css_classes: ["heading"],
        }),
      );
      content.append(
        new Gtk.Label({
          label: opt.subtitle,
          xalign: 0,
          wrap: true,
          css_classes: ["caption", "dim-label"],
        }),
      );
      card.set_child(content);
      card.connect("toggled", () => {
        if (card.active) {
          settings.set_string(SettingKey.ScreenshotThumbnailMode, opt.mode);
        }
      });
      modeButtons.set(opt.mode, card);
      modeFrame.append(card);
    }

    const syncModeCards = (): void => {
      const current = parseThumbnailMode(settings.get_string(SettingKey.ScreenshotThumbnailMode));
      const target = modeButtons.get(current);
      if (target && !target.active) target.active = true;
    };
    syncModeCards();
    signalIds.push(
      settings.connect(`changed::${SettingKey.ScreenshotThumbnailMode}`, syncModeCards),
    );
    rulesGroup.add(modeFrame);

    const maxCountRow = addSpin(
      rulesGroup,
      SettingKey.ScreenshotMaxCount,
      _("Max kept"),
      _("Clear older screenshots past this count."),
      0,
      100,
      1,
    );
    const expireRow = addSlider(
      rulesGroup,
      SettingKey.ScreenshotExpireSeconds,
      _("Clear after (seconds)"),
      _("Remove screenshots after this many seconds."),
      0,
      300,
      5,
    );
    const budgetRow = addSlider(
      rulesGroup,
      SettingKey.ScreenshotMemoryBudgetMb,
      _("Memory limit (MiB)"),
      _("Clear older screenshots above this size."),
      0,
      512,
      8,
    );

    for (const dependent of [modeFrame, maxCountRow, expireRow, budgetRow]) {
      bind(SettingKey.ScreenshotNotifyEnabled, dependent, "sensitive", Gio.SettingsBindFlags.GET);
    }
    screenshotsPage.add(rulesGroup);

    const screencastGroup = new Adw.PreferencesGroup({
      title: _("Screen recordings"),
    });
    bind(SettingKey.GuardEnabled, screencastGroup, "sensitive", Gio.SettingsBindFlags.GET);
    addSwitch(
      screencastGroup,
      SettingKey.ScreencastNotifyEnabled,
      _("Show recording alerts"),
      _("Turn off to hide screen recording alerts."),
    );
    screenshotsPage.add(screencastGroup);

    const retentionPage = new Adw.PreferencesPage({
      title: _("Limits"),
      icon_name: "preferences-system-time-symbolic",
    });

    const transientGroup = new Adw.PreferencesGroup({
      title: _("Temporary alerts"),
      description: _("Clear short-lived alerts that get stuck in Do Not Disturb."),
    });
    bind(SettingKey.GuardEnabled, transientGroup, "sensitive", Gio.SettingsBindFlags.GET);
    addHeaderSwitch(transientGroup, SettingKey.TransientExpireEnabled);

    const transientDndRow = addSwitch(
      transientGroup,
      SettingKey.TransientDndOnly,
      _("Only in Do Not Disturb"),
      _("Run only when banners are muted."),
    );
    const transientExpireRow = addSlider(
      transientGroup,
      SettingKey.TransientExpireSeconds,
      _("Clear after (seconds)"),
      _("Wait time before clearing."),
      5,
      300,
      5,
    );
    for (const dependentRow of [transientDndRow, transientExpireRow]) {
      bind(SettingKey.TransientExpireEnabled, dependentRow, "sensitive", Gio.SettingsBindFlags.GET);
    }
    retentionPage.add(transientGroup);

    const retentionGroup = new Adw.PreferencesGroup({
      title: _("All apps"),
      description: _("Applies to every app. Set 0 to disable a limit."),
    });
    bind(SettingKey.GuardEnabled, retentionGroup, "sensitive", Gio.SettingsBindFlags.GET);

    addSpin(
      retentionGroup,
      SettingKey.GlobalMaxCount,
      _("Max notifications"),
      _("Clear oldest alerts past this total."),
      0,
      100,
      1,
    );
    addSpin(
      retentionGroup,
      SettingKey.GlobalExpireMinutes,
      _("Clear after (minutes)"),
      _("Remove alerts older than this."),
      0,
      1440,
      5,
    );
    retentionPage.add(retentionGroup);

    const aboutPage = new Adw.PreferencesPage({
      title: _("About"),
      icon_name: "help-about-symbolic",
    });

    const advancedGroup = new Adw.PreferencesGroup({
      title: _("Advanced"),
    });
    addSpin(
      advancedGroup,
      SettingKey.EmergencyHardCap,
      _("Safety cap"),
      _("Hard limit on screenshots and temporary alerts."),
      0,
      256,
      8,
    );
    addSwitch(
      advancedGroup,
      SettingKey.DebugLogging,
      _("Debug logging"),
      _("Write extra logs to the system journal."),
    );

    const resetButton = new Gtk.Button({
      label: _("Reset"),
      valign: Gtk.Align.CENTER,
      css_classes: ["destructive-action"],
    });
    resetButton.connect("clicked", () => {
      for (const key of Object.values(SettingKey)) {
        try {
          settings.reset(key);
        } catch {
          // Ignore individual key reset failures.
        }
      }
    });
    const resetRow = new Adw.ActionRow({
      title: _("Reset settings"),
      subtitle: _("Restore all defaults."),
    });
    resetRow.add_suffix(resetButton);
    advancedGroup.add(resetRow);
    aboutPage.add(advancedGroup);

    const baseUrl = (this.metadata.url ?? "https://github.com/Kbgjtn/notman").replace(/\/+$/, "");
    const infoGroup = new Adw.PreferencesGroup({
      title: _("Information"),
    });
    addLinkRow(infoGroup, _("Homepage"), baseUrl);
    addLinkRow(infoGroup, _("Release notes"), `${baseUrl}/releases`);
    addLinkRow(infoGroup, _("Report an issue"), `${baseUrl}/issues/new?template=bug_report.yml`);
    addLinkRow(
      infoGroup,
      _("Feature request"),
      `${baseUrl}/issues/new?template=feature_request.yml`,
    );
    aboutPage.add(infoGroup);

    const cleanup = (): void => {
      if (disposed) return;
      disposed = true;
      if (statsTimerId !== null) {
        GLib.source_remove(statsTimerId);
        statsTimerId = null;
      }
      if (display && cssProvider) {
        Gtk.StyleContext.remove_provider_for_display(display, cssProvider);
        cssProvider = null;
      }
      for (const id of signalIds) {
        try {
          settings.disconnect(id);
        } catch {
          // Already disconnected.
        }
      }
      signalIds.length = 0;
      for (const { target, property } of bindings) {
        Gio.Settings.unbind(target as never, property);
      }
      bindings.length = 0;
    };
    window.connect("close-request", cleanup);
    window.connect("destroy", cleanup);

    window.add(generalPage);
    window.add(screenshotsPage);
    window.add(retentionPage);
    window.add(aboutPage);
  }
}
