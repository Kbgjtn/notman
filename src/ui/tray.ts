import type Gio from "gi://Gio";
import GLib from "gi://GLib";
import St from "gi://St";
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
  formatStats,
  HARD_CAP_STEPS,
  MAX_COUNT_STEPS,
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

type MenuItem = Emitter & { label: { text: string } };

type Menu = Emitter & {
  addMenuItem(item: unknown, position?: number): void;
};

const STATS_INTERVAL_MS = 2000;
const ROLE = "notman";

export interface TrayUi {
  destroy(): void;
}

export function createTrayUi(
  settings: Gio.Settings,
  engine: Engine,
  disposables: Disposables,
): TrayUi | null {
  try {
    const indicator = new PanelMenu.Button(0.5, ROLE) as unknown as Emitter & {
      menu: Menu;
      add_child(child: unknown): void;
      destroy(): void;
    };
    indicator.add_child(
      new St.Icon({
        icon_name: "preferences-system-symbolic",
        style_class: "system-status-icon notman-status-icon",
      }),
    );

    const menu = indicator.menu;
    const refreshers: Array<() => void> = [];
    const addSwitch = (
      title: string,
      read: () => boolean,
      write: (value: boolean) => void,
    ): void => {
      const item = new PopupMenu.PopupSwitchMenuItem(title, false) as unknown as SwitchItem;
      item.setToggleState(read());
      refreshers.push(() => item.setToggleState(read()));
      item.connect("toggled", () => {
        try {
          write(item.state);
        } catch (e) {
          log.err("tray", `could not update ${title}`, e);
        }
      });
      menu.addMenuItem(item);
    };

    const addCycle = (title: string, key: string, steps: readonly number[]): void => {
      const item = new PopupMenu.PopupMenuItem(
        `${title}: ${settings.get_int(key)}`,
      ) as unknown as MenuItem;
      item.connect("activate", () => {
        try {
          const next = cycleValue(settings.get_int(key), steps);
          settings.set_int(key, next);
          item.label.text = `${title}: ${next}`;
        } catch (e) {
          log.err("tray", `could not update ${key}`, e);
        }
      });
      menu.addMenuItem(item);
    };

    addSwitch(
      "Guard",
      () => settings.get_boolean("guard-enabled"),
      (value) => settings.set_boolean("guard-enabled", value),
    );
    addSwitch(
      "Screenshot notifications",
      () => settings.get_boolean("screenshot-notify-enabled"),
      (value) => settings.set_boolean("screenshot-notify-enabled", value),
    );
    addSwitch(
      "Text-only thumbnails",
      () => modeToSwitch(settings.get_string("screenshot-thumbnail-mode")),
      (value) => settings.set_string("screenshot-thumbnail-mode", switchToMode(value)),
    );
    addCycle("Max retained", "screenshot-max-count", MAX_COUNT_STEPS);
    addCycle("Expire seconds", "screenshot-expire-seconds", EXPIRE_STEPS);
    addCycle("Budget MiB", "screenshot-memory-budget-mb", BUDGET_STEPS);
    addCycle("Hard cap", "emergency-hard-cap", HARD_CAP_STEPS);

    const clearItem = new PopupMenu.PopupMenuItem("Clear screenshots") as unknown as MenuItem;
    clearItem.connect("activate", () => {
      try {
        engine.clearScreenshots();
      } catch (e) {
        log.err("tray", "clear failed", e);
      }
    });
    menu.addMenuItem(clearItem);

    const statsItem = new PopupMenu.PopupMenuItem("") as unknown as MenuItem;
    statsItem.label.text = formatStats(engine.getStats());
    menu.addMenuItem(statsItem);
    const statsTimer = GLib.timeout_add(GLib.PRIORITY_LOW, STATS_INTERVAL_MS, () => {
      try {
        statsItem.label.text = formatStats(engine.getStats());
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

    Main.panel.addToStatusArea(ROLE, indicator as never);
    disposables.add(() => {
      try {
        indicator.destroy();
      } catch {
        // Panel may already be gone.
      }
    });
    log.info("tray", "status indicator added");
    return {
      destroy() {
        try {
          indicator.destroy();
        } catch (e) {
          log.err("tray", "destroy failed", e);
        }
      },
    };
  } catch (e) {
    log.err("tray", "setup failed", e);
    return null;
  }
}
