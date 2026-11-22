import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import St from "gi://St";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

import type { Disposables } from "../disposables.js";
import type { Engine } from "../engine.js";
import { log } from "../log.js";
import {
  BUDGET_STEPS,
  cycleValue,
  EXPIRE_STEPS,
  HARD_CAP_STEPS,
  MAX_COUNT_STEPS,
  MiB,
  modeToSwitch,
  switchToMode,
} from "./mappings.js";

type Emitter = {
  connect(signal: string, callback: (...args: unknown[]) => void): number;
  disconnect(id: number): void;
};

type SwitchItem = Emitter & {
  state: boolean;
  setToggleState(state: boolean): void;
};

type MenuItem = Emitter & {
  label: { text: string };
  visible: boolean;
};

type Menu = Emitter & {
  addMenuItem(item: unknown, position?: number): void;
};

type StatRow = {
  item: unknown;
  value: { text: string };
  visible: boolean;
};

const STATS_INTERVAL_MS = 2000;
const ROLE = "notman@ozy.local";
const EXTENSION_UUID = "notman@ozy.local";

export interface TrayUi {
  destroy(): void;
}

export function createTrayUi(
  settings: Gio.Settings,
  engine: Engine,
  disposables: Disposables,
): TrayUi | null {
  try {
    const indicator = new PanelMenu.Button(0.5, _("Notman")) as unknown as Emitter & {
      menu: Menu;
      add_child(child: unknown): void;
      destroy(): void;
    };
    indicator.add_child(
      new St.Icon({
        icon_name: "preferences-system-symbolic",
        style_class: "system-status-icon",
      }),
    );
    Main.panel.addToStatusArea(ROLE, indicator as never);
    disposables.add(() => {
      try {
        indicator.destroy();
      } catch {
        // Panel may already be gone.
      }
    });

    const menu = indicator.menu;
    const refreshers: Array<() => void> = [];

    const watch = (key: string, refresh: () => void): void => {
      refreshers.push(refresh);
      const id = settings.connect(`changed::${key}`, () => {
        try {
          refresh();
        } catch (e) {
          log.err("tray", `refresh for ${key} failed`, e);
        }
      });
      disposables.add(() => {
        try {
          settings.disconnect(id);
        } catch {
          // Already gone.
        }
      });
    };

    const addSwitch = (
      title: string,
      key: string,
      read: () => boolean,
      write: (value: boolean) => void,
    ): void => {
      const item = new PopupMenu.PopupSwitchMenuItem(title, false) as unknown as SwitchItem;
      item.setToggleState(read());
      watch(key, () => item.setToggleState(read()));
      item.connect("toggled", () => {
        try {
          write(item.state);
        } catch (e) {
          log.err("tray", `could not update ${key}`, e);
        }
      });
      menu.addMenuItem(item);
    };

    const addCycle = (title: string, key: string, steps: readonly number[]): void => {
      const render = (value: number): string => `${title}: ${value}`;
      const item = new PopupMenu.PopupMenuItem(
        render(settings.get_int(key)),
      ) as unknown as MenuItem;
      watch(key, () => {
        item.label.text = render(settings.get_int(key));
      });
      item.connect("activate", () => {
        try {
          settings.set_int(key, cycleValue(settings.get_int(key), steps));
        } catch (e) {
          log.err("tray", `could not update ${key}`, e);
        }
      });
      menu.addMenuItem(item);
    };

    const addStatRow = (title: string): StatRow => {
      const item = new PopupMenu.PopupBaseMenuItem({
        reactive: false,
        can_focus: false,
      }) as unknown as Emitter & {
        actor: { add_child(child: unknown): void };
        visible: boolean;
      };
      const box = new St.BoxLayout({ x_expand: true }) as unknown as {
        add_child(child: unknown): void;
      };
      const label = new St.Label({
        text: title,
        style_class: "dim-label",
      });
      const value = new St.Label({
        text: "",
        x_expand: true,
        x_align: Clutter.ActorAlign.END,
      });
      box.add_child(label);
      box.add_child(value);
      item.actor.add_child(box);
      menu.addMenuItem(item);
      return { item, value: value as unknown as { text: string }, visible: true };
    };

    addSwitch(
      _("Guard"),
      "guard-enabled",
      () => settings.get_boolean("guard-enabled"),
      (value) => settings.set_boolean("guard-enabled", value),
    );
    addSwitch(
      _("Screenshot notifications"),
      "screenshot-notify-enabled",
      () => settings.get_boolean("screenshot-notify-enabled"),
      (value) => settings.set_boolean("screenshot-notify-enabled", value),
    );
    addSwitch(
      _("Text-only thumbnails"),
      "screenshot-thumbnail-mode",
      () => modeToSwitch(settings.get_string("screenshot-thumbnail-mode")),
      (value) => settings.set_string("screenshot-thumbnail-mode", switchToMode(value)),
    );
    menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    addCycle(_("Max retained"), "screenshot-max-count", MAX_COUNT_STEPS);
    addCycle(_("Expire seconds"), "screenshot-expire-seconds", EXPIRE_STEPS);
    addCycle(_("Budget MiB"), "screenshot-memory-budget-mb", BUDGET_STEPS);
    addCycle(_("Hard cap"), "emergency-hard-cap", HARD_CAP_STEPS);
    menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    const keptRow = addStatRow(_("Kept notifications"));
    const memoryRow = addStatRow(_("Thumbnail memory"));
    const rssRow = addStatRow(_("Shell memory"));
    const prunedRow = addStatRow(_("Pruned"));
    const statsRows = [keptRow, memoryRow, rssRow, prunedRow];

    const setStatsVisible = (visible: boolean): void => {
      for (const row of statsRows) {
        row.visible = visible;
        (row.item as { visible: boolean }).visible = visible;
      }
    };
    watch("show-stats", () => setStatsVisible(settings.get_boolean("show-stats")));
    setStatsVisible(settings.get_boolean("show-stats"));

    const clearItem = new PopupMenu.PopupMenuItem(_("Clear screenshots")) as unknown as MenuItem;
    clearItem.connect("activate", () => {
      try {
        engine.clearScreenshots();
      } catch (e) {
        log.err("tray", "clear failed", e);
      }
    });
    menu.addMenuItem(clearItem);

    const prefsItem = new PopupMenu.PopupMenuItem(_("Extension Settings…")) as unknown as MenuItem;
    prefsItem.connect("activate", () => {
      Gio.DBus.session.call(
        "org.gnome.Shell",
        "/org/gnome/Shell",
        "org.gnome.Shell.Extensions",
        "OpenExtensionPrefs",
        new GLib.Variant("(ssa{sv})", [EXTENSION_UUID, "", {}]) as never,
        null,
        Gio.DBusCallFlags.NONE,
        -1,
        null,
        (connection, result) => {
          try {
            connection?.call_finish(result);
          } catch (e) {
            log.err("tray", "could not open preferences", e);
          }
        },
      );
    });
    menu.addMenuItem(prefsItem);

    const statsTimer = GLib.timeout_add(GLib.PRIORITY_LOW, STATS_INTERVAL_MS, () => {
      try {
        if (settings.get_boolean("show-stats")) {
          const stats = engine.getStats();
          keptRow.value.text = String(stats.activeCount);
          memoryRow.value.text =
            `${(stats.estimatedBytes / MiB).toFixed(1)} / ` +
            `${(stats.peakBytes / MiB).toFixed(1)} MiB`;
          rssRow.value.text = `${(stats.shellRssBytes / MiB).toFixed(0)} MiB`;
          prunedRow.value.text = String(stats.prunedCount);
        }
      } catch (e) {
        log.err("tray", "stats update failed", e);
      }
      return GLib.SOURCE_CONTINUE;
    });
    disposables.add(() => GLib.source_remove(statsTimer));

    const openId = menu.connect("open-state-changed", (...args: unknown[]) => {
      try {
        if (args[1]) {
          for (const refresh of refreshers) refresh();
          if (settings.get_boolean("clear-on-panel-open")) engine.clearScreenshots();
        }
      } catch (e) {
        log.err("tray", "clear-on-open failed", e);
      }
    });
    disposables.add(() => {
      try {
        menu.disconnect(openId);
      } catch {
        // Already gone.
      }
    });

    log.info("tray", "status indicator added");
    return {
      // Disposables own teardown; avoid destroying the indicator twice.
      destroy() {},
    };
  } catch (e) {
    log.err("tray", "setup failed", e);
    return null;
  }
}
