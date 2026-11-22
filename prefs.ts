import Adw from 'gi://Adw';
import {
  gettext as _,
  ExtensionPreferences,
} from 'resource:///org/gnome/shell/extensions/prefs.js';

/**
 * Stage 0 skeleton. The full Adwaita preferences page is built in Stage 2.
 * Import path is pinned to the verified GNOME 46 module (the gjs.guide sample
 * uses an outdated path).
 */
export default class NotmanPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window: Adw.PreferencesWindow): Promise<void> {
    const page = new Adw.PreferencesPage({
      title: _('Notman'),
    });
    window.add(page);
    return Promise.resolve();
  }
}
