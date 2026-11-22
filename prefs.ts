import Adw from "gi://Adw";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Gtk from "gi://Gtk";
import {
  gettext as _,
  ExtensionPreferences,
} from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

import { formatMiB } from "./src/byte-estimate.js";
import { DBUS_BUS_NAME, DBUS_OBJECT_PATH, DbusMethod } from "./src/dbus.js";
import { parseThumbnailMode, SettingKey } from "./src/settings.js";
import { ThumbnailMode } from "./src/types.js";

const THUMBNAIL_MODES: readonly ThumbnailMode[] = [
  ThumbnailMode.Full,
  ThumbnailMode.Compact,
  ThumbnailMode.TextOnly,
];

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

export default class NotmanPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window: Adw.PreferencesWindow): void {
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

    const page = new Adw.PreferencesPage({
      title: _("Notman"),
      icon_name: "screenshot-recorded-symbolic",
    });

    const statusGroup = new Adw.PreferencesGroup({
      title: _("Status"),
    });
    const activeRow = new Adw.ActionRow({ title: _("Active screenshots") });
    const prunedRow = new Adw.ActionRow({ title: _("Pruned this session") });
    statusGroup.add(activeRow);
    statusGroup.add(prunedRow);
    page.add(statusGroup);

    const refreshStatus = (): void => {
      fetchStatsAsync((stats) => {
        if (disposed) return;
        if (!stats) {
          statusGroup.description = _(
            "Notman is not active. Enable the extension or reload GNOME Shell.",
          );
          activeRow.subtitle = _("Unavailable");
          prunedRow.subtitle = "—";
          return;
        }
        statusGroup.description = "";
        activeRow.subtitle =
          stats.estimatedBytes > 0
            ? `${stats.activeCount} (${formatMiB(stats.estimatedBytes)})`
            : String(stats.activeCount);
        prunedRow.subtitle =
          stats.peakBytes > 0
            ? `${stats.prunedCount} · ${_("Peak")} ${formatMiB(stats.peakBytes)}`
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
      _("Enable guard"),
      _("Turn off to let GNOME handle notifications unchanged."),
    );
    addSwitch(
      generalGroup,
      SettingKey.ShowIndicator,
      _("Show top-bar indicator"),
      _("Display quick toggles and live status in the top bar."),
    );
    addSwitch(
      generalGroup,
      SettingKey.ClearOnPanelOpen,
      _("Clear when notification list opens"),
      _("Remove kept screenshot notifications when opening the calendar menu."),
    );
    page.add(generalGroup);

    const rulesGroup = new Adw.PreferencesGroup({
      title: _("Screenshot notifications"),
      description: _("Zero disables an individual limit."),
    });
    bind(SettingKey.GuardEnabled, rulesGroup, "sensitive", Gio.SettingsBindFlags.GET);

    addSwitch(
      rulesGroup,
      SettingKey.ScreenshotNotifyEnabled,
      _("Allow screenshot notifications"),
      _("Turn off to discard screenshot notifications immediately."),
    );

    const modes = new Gtk.StringList({});
    modes.append(_("Full thumbnail"));
    modes.append(_("Compact thumbnail"));
    modes.append(_("Text only"));
    const modeRow = new Adw.ComboRow({
      title: _("Thumbnail mode"),
      subtitle: _(
        "Compact downscales previews to save memory; text only removes the image immediately.",
      ),
      model: modes,
    });
    const readModeIndex = (): number => {
      const current = parseThumbnailMode(settings.get_string(SettingKey.ScreenshotThumbnailMode));
      return Math.max(0, THUMBNAIL_MODES.indexOf(current));
    };
    modeRow.selected = readModeIndex();
    modeRow.connect("notify::selected", () => {
      const mode = THUMBNAIL_MODES[modeRow.selected] ?? ThumbnailMode.Full;
      settings.set_string(SettingKey.ScreenshotThumbnailMode, mode);
    });
    signalIds.push(
      settings.connect(`changed::${SettingKey.ScreenshotThumbnailMode}`, () => {
        const selected = readModeIndex();
        if (modeRow.selected !== selected) modeRow.selected = selected;
      }),
    );
    rulesGroup.add(modeRow);

    const maxCountRow = addSpin(
      rulesGroup,
      SettingKey.ScreenshotMaxCount,
      _("Maximum retained"),
      _("Oldest screenshot notifications are removed beyond this count."),
      0,
      100,
      1,
    );
    const expireRow = addSpin(
      rulesGroup,
      SettingKey.ScreenshotExpireSeconds,
      _("Expire after (seconds)"),
      _("Remove screenshot notifications after this many seconds."),
      0,
      300,
      1,
    );
    const budgetRow = addSpin(
      rulesGroup,
      SettingKey.ScreenshotMemoryBudgetMb,
      _("Memory budget (MiB)"),
      _("Prune oldest screenshots when estimated thumbnail memory exceeds this limit."),
      0,
      512,
      8,
    );

    for (const dependentRow of [modeRow, maxCountRow, expireRow, budgetRow]) {
      bind(
        SettingKey.ScreenshotNotifyEnabled,
        dependentRow,
        "sensitive",
        Gio.SettingsBindFlags.GET,
      );
    }
    page.add(rulesGroup);

    const advancedGroup = new Adw.PreferencesGroup({
      title: _("Advanced"),
    });
    addSpin(
      advancedGroup,
      SettingKey.EmergencyHardCap,
      _("Emergency hard cap"),
      _("Last-resort limit on tracked notifications even when other limits are disabled."),
      0,
      256,
      8,
    );
    addSwitch(
      advancedGroup,
      SettingKey.DebugLogging,
      _("Verbose logging"),
      _("Write detailed tracking logs to the system journal."),
    );
    page.add(advancedGroup);

    const cleanup = (): void => {
      if (disposed) return;
      disposed = true;
      if (statsTimerId !== null) {
        GLib.source_remove(statsTimerId);
        statsTimerId = null;
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

    window.add(page);
  }
}
