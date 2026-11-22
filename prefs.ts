import Adw from "gi://Adw";
import {
  gettext as _,
  ExtensionPreferences,
} from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

/**
 * This is the resource path used by the GNOME 46 shell build; the shorter
 * source-tree path does not exist in the compiled resources.
 */
export default class NotmanPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window: Adw.PreferencesWindow): Promise<void> {
    const page = new Adw.PreferencesPage({
      title: _("Notman"),
    });
    window.add(page);
    return Promise.resolve();
  }
}
