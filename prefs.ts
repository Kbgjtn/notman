import Adw from "gi://Adw";
import Gio from "gi://Gio";
import type GLib from "gi://GLib";
import Gtk from "gi://Gtk";
import {
  gettext as _,
  ExtensionPreferences,
} from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";
import { MiB } from "./src/ui/mappings.js";

function addSwitch(
  group: Adw.PreferencesGroup,
  settings: Gio.Settings,
  key: string,
  title: string,
  subtitle: string,
): void {
  const row = new Adw.SwitchRow({ title, subtitle });
  settings.bind(key, row, "active", Gio.SettingsBindFlags.DEFAULT);
  group.add(row);
}

function addSpin(
  group: Adw.PreferencesGroup,
  settings: Gio.Settings,
  key: string,
  title: string,
  subtitle: string,
  lower: number,
  upper: number,
  step: number,
): void {
  const adjustment = new Gtk.Adjustment({
    lower,
    upper,
    step_increment: step,
    value: settings.get_int(key),
  });
  const row = new Adw.SpinRow({ title, subtitle, adjustment });
  settings.bind(key, row, "value", Gio.SettingsBindFlags.DEFAULT);
  group.add(row);
}

function readStats(): Record<string, string | number> | null {
  try {
    const proxy = new Gio.DBusProxy({
      g_connection: Gio.DBus.session,
      g_interface_name: "org.gnome.Shell.Extensions.Notman",
      g_name: "org.gnome.Shell.Extensions.Notman",
      g_object_path: "/org/gnome/Shell/Extensions/Notman",
    });
    const reply = proxy.call_sync("GetStats", null, Gio.DBusCallFlags.NONE, 2000, null);
    const [dict] = reply.deepUnpack() as [Record<string, GLib.Variant>];
    return {
      activeCount: dict.activeCount.get_int32(),
      estimatedBytes: Number(dict.estimatedBytes.get_int64()),
      peakBytes: Number(dict.peakBytes.get_int64()),
      prunedCount: dict.prunedCount.get_int32(),
      shellRssBytes: Number(dict.shellRssBytes.get_int64()),
      adapterId: dict.adapterId.deepUnpack() as string,
      tier: dict.tier.get_int32(),
    };
  } catch {
    return null;
  }
}

export default class NotmanPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window: Adw.PreferencesWindow): void {
    const settings = this.getSettings();
    const page = new Adw.PreferencesPage({ title: _("Notman") });

    const status = new Adw.PreferencesGroup({
      title: _("Status"),
      description: _("Live information from the running extension."),
    });
    const keptRow = new Adw.ActionRow({ title: _("Kept notifications") });
    const memoryRow = new Adw.ActionRow({ title: _("Thumbnail memory / peak") });
    const shellRow = new Adw.ActionRow({ title: _("Shell memory") });
    const prunedRow = new Adw.ActionRow({ title: _("Pruned") });
    const adapterRow = new Adw.ActionRow({ title: _("Adapter / tier") });
    for (const row of [keptRow, memoryRow, shellRow, prunedRow, adapterRow]) status.add(row);
    page.add(status);

    const refreshStatus = (): void => {
      const stats = readStats();
      if (!stats) {
        keptRow.subtitle = _("Unavailable");
        memoryRow.subtitle = "—";
        shellRow.subtitle = "—";
        prunedRow.subtitle = "—";
        adapterRow.subtitle = "—";
        return;
      }
      keptRow.subtitle = String(stats.activeCount);
      memoryRow.subtitle =
        `${(Number(stats.estimatedBytes) / MiB).toFixed(1)} / ` +
        `${(Number(stats.peakBytes) / MiB).toFixed(1)} MiB`;
      shellRow.subtitle = `${(Number(stats.shellRssBytes) / MiB).toFixed(0)} MiB`;
      prunedRow.subtitle = String(stats.prunedCount);
      adapterRow.subtitle = `${stats.adapterId} / ${stats.tier}`;
    };
    refreshStatus();

    const guard = new Adw.PreferencesGroup({
      title: _("Guard"),
      description: _("Retention rules applied to screenshot notifications."),
    });
    addSwitch(
      guard,
      settings,
      "guard-enabled",
      _("Enable guard"),
      _("Turn off to let GNOME handle notifications unchanged."),
    );
    addSwitch(
      guard,
      settings,
      "screenshot-notify-enabled",
      _("Screenshot notifications"),
      _("Turn off to discard screenshot notifications on arrival."),
    );
    page.add(guard);

    const rules = new Adw.PreferencesGroup({
      title: _("Screenshot rules"),
      description: _("Limits are opt-out; zero means unlimited."),
    });
    const modes = new Gtk.StringList({});
    modes.append(_("Full thumbnail"));
    modes.append(_("Text only"));
    const modeRow = new Adw.ComboRow({
      title: _("Thumbnail"),
      subtitle: _("Text only releases the full-resolution image."),
      model: modes,
    });
    modeRow.selected = settings.get_string("screenshot-thumbnail-mode") === "text-only" ? 1 : 0;
    modeRow.connect("notify::selected", () => {
      settings.set_string(
        "screenshot-thumbnail-mode",
        modeRow.selected === 1 ? "text-only" : "full",
      );
    });
    const modeChangedId = settings.connect("changed::screenshot-thumbnail-mode", () => {
      const selected = settings.get_string("screenshot-thumbnail-mode") === "text-only" ? 1 : 0;
      if (modeRow.selected !== selected) modeRow.selected = selected;
    });
    window.connect("close-request", () => settings.disconnect(modeChangedId));
    rules.add(modeRow);
    addSpin(
      rules,
      settings,
      "screenshot-max-count",
      _("Maximum retained"),
      _("Oldest notifications are removed beyond this count."),
      0,
      100,
      1,
    );
    addSpin(
      rules,
      settings,
      "screenshot-expire-seconds",
      _("Expire after"),
      _("Seconds before a notification is removed; zero disables."),
      0,
      300,
      1,
    );
    addSpin(
      rules,
      settings,
      "screenshot-memory-budget-mb",
      _("Memory budget"),
      _("Estimated thumbnail memory in MiB; zero disables."),
      0,
      512,
      8,
    );
    addSpin(
      rules,
      settings,
      "emergency-hard-cap",
      _("Emergency hard cap"),
      _("Last-resort notification limit; zero disables it."),
      0,
      256,
      8,
    );
    page.add(rules);

    const panel = new Adw.PreferencesGroup({
      title: _("Panel"),
      description: _("Controls in the calendar notification list."),
    });
    addSwitch(
      panel,
      settings,
      "show-stats",
      _("Show live stats"),
      _("Display kept count and estimated memory in the panel."),
    );
    addSwitch(
      panel,
      settings,
      "clear-on-panel-open",
      _("Clear on panel open"),
      _("Remove screenshot notifications when the calendar opens."),
    );
    page.add(panel);

    const diagnostics = new Adw.PreferencesGroup({
      title: _("Diagnostics"),
    });
    addSwitch(
      diagnostics,
      settings,
      "debug-logging",
      _("Verbose logging"),
      _("Write detailed tracking logs to the journal."),
    );
    page.add(diagnostics);

    window.add(page);
  }
}
