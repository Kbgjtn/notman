import type Gio from "gi://Gio";
import GLib from "gi://GLib";
import St from "gi://St";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

import type { ShellAdapter } from "../compat/adapter.js";
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

type ControlsRow = Emitter & {
  insert_child_at_index(child: unknown, index: number): void;
};

type SwitchItem = Emitter & { state: boolean };
type MenuItem = Emitter & { label: { text: string }; visible: boolean };
type Menu = Emitter & {
  isOpen: boolean;
  addMenuItem(item: unknown): void;
  open(animate: boolean): void;
  close(animate: boolean): void;
  destroy(): void;
};

const STATS_INTERVAL_MS = 2000;

export interface PanelUi {
  destroy(): void;
}

export function createPanelUi(
  adapter: ShellAdapter,
  settings: Gio.Settings,
  engine: Engine,
  disposables: Disposables,
): PanelUi | null {
  const row = adapter.getNotificationControlsRow();
  if (!row || typeof row !== "object") return null;
  const controls = row as ControlsRow;
  if (typeof controls.insert_child_at_index !== "function") return null;

  const button = new St.Button({
    style_class: "notman-panel-button",
    can_focus: true,
    child: new St.Icon({
      icon_name: "preferences-system-symbolic",
      style_class: "popup-menu-icon",
    }),
  });
  const menu = new PopupMenu.PopupMenu(button, 0.5, St.Side.TOP) as unknown as Menu;
  const menuManager = (
    Main.panel as unknown as {
      menuManager?: { addMenu(menu: unknown): void; removeMenu(menu: unknown): void };
    } | null
  )?.menuManager;
  menuManager?.addMenu(menu);
  disposables.add(() => {
    try {
      menuManager?.removeMenu(menu);
    } catch {
      // Panel may already be gone.
    }
  });

  const addSwitch = (
    label: string,
    key: string,
    mapToState?: (value: string) => boolean,
    mapFromState?: (state: boolean) => string,
  ): void => {
    const item = new PopupMenu.PopupSwitchMenuItem(label, false) as unknown as SwitchItem;
    const read = (): void => {
      item.state = mapToState ? mapToState(settings.get_string(key)) : settings.get_boolean(key);
    };
    read();
    item.connect("toggled", () => {
      try {
        if (mapFromState) settings.set_string(key, mapFromState(item.state));
        else settings.set_boolean(key, item.state);
      } catch (e) {
        log.err("panel", `could not update ${key}`, e);
      }
    });
    menu.addMenuItem(item);
  };

  const addCycle = (label: string, key: string, steps: readonly number[]): void => {
    const item = new PopupMenu.PopupMenuItem(label) as unknown as MenuItem;
    const refresh = (): void => {
      item.label.text = `${label}: ${settings.get_int(key)}`;
    };
    refresh();
    item.connect("activate", () => {
      try {
        const next = cycleValue(settings.get_int(key), steps);
        settings.set_int(key, next);
        refresh();
      } catch (e) {
        log.err("panel", `could not update ${key}`, e);
      }
    });
    menu.addMenuItem(item);
  };

  try {
    addSwitch("Guard", "guard-enabled");
    addSwitch("Screenshot notifications", "screenshot-notify-enabled");
    addSwitch("Text-only thumbnails", "screenshot-thumbnail-mode", modeToSwitch, switchToMode);
    addCycle("Max retained", "screenshot-max-count", MAX_COUNT_STEPS);
    addCycle("Expire seconds", "screenshot-expire-seconds", EXPIRE_STEPS);
    addCycle("Budget MiB", "screenshot-memory-budget-mb", BUDGET_STEPS);
    addCycle("Hard cap", "emergency-hard-cap", HARD_CAP_STEPS);

    const clearItem = new PopupMenu.PopupMenuItem("Clear screenshots") as unknown as MenuItem;
    clearItem.connect("activate", () => {
      try {
        engine.clearScreenshots();
      } catch (e) {
        log.err("panel", "clear failed", e);
      }
    });
    menu.addMenuItem(clearItem);

    const statsItem = new PopupMenu.PopupMenuItem("") as unknown as MenuItem;
    menu.addMenuItem(statsItem);
    statsItem.label.text = formatStats(engine.getStats());
    statsItem.visible = settings.get_boolean("show-stats");
    const statsTimer = GLib.timeout_add(GLib.PRIORITY_LOW, STATS_INTERVAL_MS, () => {
      try {
        statsItem.label.text = formatStats(engine.getStats());
        statsItem.visible = settings.get_boolean("show-stats");
      } catch (e) {
        log.err("panel", "stats update failed", e);
      }
      return GLib.SOURCE_CONTINUE;
    });
    disposables.add(() => GLib.source_remove(statsTimer));

    const clickId = button.connect("clicked", () => {
      try {
        if (menu.isOpen) menu.close(true);
        else menu.open(true);
      } catch (e) {
        log.err("panel", "menu toggle failed", e);
      }
    });
    disposables.add(() => {
      try {
        button.disconnect(clickId);
      } catch {
        // Already gone.
      }
    });

    controls.insert_child_at_index(button, 0);
    disposables.add(() => {
      try {
        button.destroy();
      } catch {
        // Already gone.
      }
    });

    const dateMenu = adapter.getDateMenuMenu();
    if (dateMenu && typeof (dateMenu as Emitter).connect === "function") {
      const emitter = dateMenu as Emitter;
      const openId = emitter.connect("open-state-changed", (...args: unknown[]) => {
        try {
          if (args[1] && settings.get_boolean("clear-on-panel-open")) engine.clearScreenshots();
        } catch (e) {
          log.err("panel", "clear-on-open failed", e);
        }
      });
      disposables.add(() => {
        try {
          emitter.disconnect(openId);
        } catch {
          // Already gone.
        }
      });
    }
  } catch (e) {
    log.err("panel", "setup failed", e);
    try {
      menu.destroy();
    } catch {
      // Ignore.
    }
    return null;
  }

  return {
    destroy() {
      try {
        menu.destroy();
      } catch (e) {
        log.err("panel", "destroy failed", e);
      }
    },
  };
}
