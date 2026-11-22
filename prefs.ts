import Adw from "gi://Adw";
import Gio from "gi://Gio";
import Gtk from "gi://Gtk";
import {
  gettext as _,
  ExtensionPreferences,
} from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

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

export default class NotmanPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window: Adw.PreferencesWindow): Promise<void> {
    const settings = this.getSettings();
    const page = new Adw.PreferencesPage({ title: _("Notman") });

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
    return Promise.resolve();
  }
}
