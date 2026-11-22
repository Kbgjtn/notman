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

const INDICATOR_POSITIONS: readonly IndicatorPosition[] = [
  IndicatorPosition.Left,
  IndicatorPosition.Center,
  IndicatorPosition.Right,
];

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
`;

interface LiveStats {
  readonly activeCount: number;
  readonly estimatedBytes: number;
  readonly peakBytes: number;
  readonly prunedCount: number;
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
    const activeRow = new Adw.ActionRow({ title: _("Active notifications") });
    const prunedRow = new Adw.ActionRow({ title: _("Cleaned this session") });
    statusGroup.add(activeRow);
    statusGroup.add(prunedRow);
    generalPage.add(statusGroup);

    const refreshStatus = (): void => {
      fetchStatsAsync((stats) => {
        if (disposed) return;
        if (!stats) {
          statusGroup.description = _(
            "Notman isn't running right now. Enable the extension or reload GNOME Shell.",
          );
          activeRow.subtitle = _("Unavailable");
          prunedRow.subtitle = "—";
          return;
        }
        statusGroup.description = "";
        activeRow.subtitle =
          stats.estimatedBytes > 0
            ? `${stats.activeCount} (${formatBytes(stats.estimatedBytes)})`
            : String(stats.activeCount);
        prunedRow.subtitle =
          stats.peakBytes > 0
            ? `${stats.prunedCount} · ${_("Peak")} ${formatBytes(stats.peakBytes)}`
            : String(stats.prunedCount);
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
    addSwitch(
      generalGroup,
      SettingKey.GuardEnabled,
      _("Manage notifications"),
      _("Pause Notman to let GNOME handle notifications on its own."),
    );
    addSwitch(
      generalGroup,
      SettingKey.ClearOnPanelOpen,
      _("Clear screenshots when opening the panel"),
      _("Automatically dismiss screenshot notifications when you open the calendar drawer."),
    );
    generalPage.add(generalGroup);

    const topBarGroup = new Adw.PreferencesGroup({
      title: _("Top bar"),
      description: _("Add a quick menu and live counter to the top bar."),
    });
    addHeaderSwitch(topBarGroup, SettingKey.ShowIndicator);

    const positions = new Gtk.StringList({});
    positions.append(_("Left"));
    positions.append(_("Center"));
    positions.append(_("Right"));
    const positionRow = new Adw.ComboRow({
      title: _("Position"),
      subtitle: _("Where the icon sits in the top bar."),
      model: positions,
    });
    const readPositionIndex = (): number => {
      const current = parseIndicatorPosition(settings.get_string(SettingKey.IndicatorPosition));
      return Math.max(0, INDICATOR_POSITIONS.indexOf(current));
    };
    positionRow.selected = readPositionIndex();
    positionRow.connect("notify::selected", () => {
      const pos = INDICATOR_POSITIONS[positionRow.selected] ?? IndicatorPosition.Right;
      settings.set_string(SettingKey.IndicatorPosition, pos);
    });
    signalIds.push(
      settings.connect(`changed::${SettingKey.IndicatorPosition}`, () => {
        const selected = readPositionIndex();
        if (positionRow.selected !== selected) positionRow.selected = selected;
      }),
    );
    topBarGroup.add(positionRow);

    const indexRow = addSpin(
      topBarGroup,
      SettingKey.IndicatorIndex,
      _("Order"),
      _("Fine-tune the icon's placement within that section."),
      0,
      20,
      1,
    );
    for (const dependentRow of [positionRow, indexRow]) {
      bind(SettingKey.ShowIndicator, dependentRow, "sensitive", Gio.SettingsBindFlags.GET);
    }
    generalPage.add(topBarGroup);

    const screenshotsPage = new Adw.PreferencesPage({
      title: _("Screenshots"),
      icon_name: "camera-photo-symbolic",
    });

    const rulesGroup = new Adw.PreferencesGroup({
      title: _("Screenshot notifications"),
      description: _("Choose how screenshot previews are kept. Set a limit to 0 to turn it off."),
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
        subtitle: _("Original resolution (~32 MiB at 4K)"),
      },
      {
        mode: ThumbnailMode.Compact,
        icon: "view-grid-symbolic",
        title: _("Compact"),
        subtitle: _("128 px preview (~36 KB, 99.8% less RAM)"),
      },
      {
        mode: ThumbnailMode.TextOnly,
        icon: "text-x-generic-symbolic",
        title: _("Text only"),
        subtitle: _("Icon & text only (0 B texture)"),
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
      _("Older screenshots are cleared once you go past this number."),
      0,
      100,
      1,
    );
    const expireRow = addSlider(
      rulesGroup,
      SettingKey.ScreenshotExpireSeconds,
      _("Auto-dismiss after (seconds)"),
      _("Clear screenshot notifications once they're this old."),
      0,
      300,
      5,
    );
    const budgetRow = addSlider(
      rulesGroup,
      SettingKey.ScreenshotMemoryBudgetMb,
      _("Memory limit (MiB)"),
      _("Clear older screenshots when preview memory goes over this limit."),
      0,
      512,
      8,
    );

    for (const dependent of [modeFrame, maxCountRow, expireRow, budgetRow]) {
      bind(SettingKey.ScreenshotNotifyEnabled, dependent, "sensitive", Gio.SettingsBindFlags.GET);
    }
    screenshotsPage.add(rulesGroup);

    const screencastGroup = new Adw.PreferencesGroup({
      title: _("Screencast notifications"),
    });
    bind(SettingKey.GuardEnabled, screencastGroup, "sensitive", Gio.SettingsBindFlags.GET);
    addSwitch(
      screencastGroup,
      SettingKey.ScreencastNotifyEnabled,
      _("Show screencast notifications"),
      _("Turn off to dismiss screen-recording notifications right away."),
    );
    screenshotsPage.add(screencastGroup);

    const retentionPage = new Adw.PreferencesPage({
      title: _("Retention"),
      icon_name: "preferences-system-time-symbolic",
    });

    const transientGroup = new Adw.PreferencesGroup({
      title: _("Temporary notifications"),
      description: _(
        "Clean up short-lived alerts from other apps that get stuck during Do Not Disturb.",
      ),
    });
    bind(SettingKey.GuardEnabled, transientGroup, "sensitive", Gio.SettingsBindFlags.GET);
    addHeaderSwitch(transientGroup, SettingKey.TransientExpireEnabled);

    const transientDndRow = addSwitch(
      transientGroup,
      SettingKey.TransientDndOnly,
      _("Only during Do Not Disturb"),
      _("Run this cleanup only when notification banners are muted."),
    );
    const transientExpireRow = addSlider(
      transientGroup,
      SettingKey.TransientExpireSeconds,
      _("Clear after (seconds)"),
      _("How long to wait before dismissing temporary alerts."),
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
      description: _("Applies to all apps. Set a limit to 0 to turn it off."),
    });
    bind(SettingKey.GuardEnabled, retentionGroup, "sensitive", Gio.SettingsBindFlags.GET);

    addSpin(
      retentionGroup,
      SettingKey.GlobalMaxCount,
      _("Max total notifications"),
      _("Clear the oldest non-critical notifications past this total."),
      0,
      100,
      1,
    );
    addSpin(
      retentionGroup,
      SettingKey.GlobalExpireMinutes,
      _("Auto-dismiss after (minutes)"),
      _("Clear non-critical notifications once they're this old."),
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
      _("Hard ceiling on screenshots and temporary alerts even if other limits are off."),
      0,
      256,
      8,
    );
    addSwitch(
      advancedGroup,
      SettingKey.DebugLogging,
      _("Debug logging"),
      _("Write detailed activity logs to the system journal."),
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
      subtitle: _("Restore all Notman preferences to their default values."),
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
