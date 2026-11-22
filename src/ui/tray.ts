import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import St from "gi://St";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import * as BoxPointer from "resource:///org/gnome/shell/ui/boxpointer.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

import type { ShellAdapter } from "../compat/adapter.js";
import type { Disposables } from "../disposables.js";
import type { Engine } from "../engine.js";
import { log } from "../log.js";
import { clampInt, MiB, modeToSwitch, switchToMode } from "./mappings.js";

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
  close(animate: unknown): void;
};

type StatRow = {
  item: unknown;
  value: { text: string };
};

const STATS_INTERVAL_MS = 2000;
const ROLE = "notman@ozy.local";
const EXTENSION_UUID = "notman@ozy.local";

export interface TrayUi {
  destroy(): void;
}

export function createTrayUi(
  adapter: ShellAdapter,
  settings: Gio.Settings,
  engine: Engine,
  disposables: Disposables,
): TrayUi | null {
  try {
    const indicator = new PanelMenu.Button(
      0.5,
      _("Screenshot notification settings"),
    ) as unknown as Emitter & {
      menu: Menu;
      add_child(child: unknown): void;
      destroy(): void;
    };
    indicator.add_child(
      new St.Icon({
        icon_name: "screenshot-recorded-symbolic",
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

    // PopupMenu closes on any item activation. Shadow that behaviour on this
    // menu so controls stay open; actions that should close call close() themselves.
    if (typeof (menu as unknown as { itemActivated?: unknown }).itemActivated === "function")
      (menu as unknown as { itemActivated(): void }).itemActivated = () => {};

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

    const addSpinRow = (
      title: string,
      key: string,
      step: number,
      unit: string,
      zeroLabel: string,
    ): void => {
      type Stepper = Emitter & {
        actor: { add_child(child: unknown): void };
        accessible_name: string;
      };
      const item = new PopupMenu.PopupBaseMenuItem({
        reactive: true,
        can_focus: true,
      }) as unknown as Stepper;
      const [, rangeVariant] = settings.get_range(key).deepUnpack() as [string, GLib.Variant];
      const [min, max] = rangeVariant.deepUnpack() as [number, number];
      const render = (value: number): string => (value === 0 ? zeroLabel : `${value}${unit}`);
      const nameLabel = new St.Label({ text: title, opacity: 170 });
      const valueLabel = new St.Label({
        text: render(settings.get_int(key)),
        x_expand: true,
        x_align: Clutter.ActorAlign.END,
      });
      const minus = new St.Button({
        can_focus: true,
        child: new St.Icon({ icon_name: "list-remove-symbolic" }),
      }) as unknown as Emitter & { accessible_name: string };
      const plus = new St.Button({
        can_focus: true,
        child: new St.Icon({ icon_name: "list-add-symbolic" }),
      }) as unknown as Emitter & { accessible_name: string };
      minus.accessible_name = `${_("Decrease")} ${title}`;
      plus.accessible_name = `${_("Increase")} ${title}`;
      const box = new St.BoxLayout({ x_expand: true }) as unknown as {
        add_child(child: unknown): void;
        layout_manager: { spacing: number };
      };
      box.layout_manager.spacing = 12;
      const steppers = new St.BoxLayout() as unknown as {
        add_child(child: unknown): void;
        layout_manager: { spacing: number };
      };
      steppers.layout_manager.spacing = 4;
      steppers.add_child(minus);
      steppers.add_child(plus);
      box.add_child(nameLabel);
      box.add_child(valueLabel);
      box.add_child(steppers);
      item.actor.add_child(box);
      menu.addMenuItem(item);

      const syncName = (): void => {
        item.accessible_name = `${title}: ${render(settings.get_int(key))}`;
      };
      watch(key, () => {
        valueLabel.text = render(settings.get_int(key));
        syncName();
      });
      syncName();

      const change = (delta: number): void => {
        try {
          settings.set_int(key, clampInt(settings.get_int(key) + delta, min, max, min));
        } catch (e) {
          log.err("tray", `could not update ${key}`, e);
        }
      };
      minus.connect("clicked", () => change(-step));
      plus.connect("clicked", () => change(step));
      item.connect("activate", () => change(step));
      item.connect("key-press-event", (_actor: unknown, rawEvent: unknown) => {
        const event = rawEvent as { get_key_symbol(): number };
        const symbol = event.get_key_symbol();
        if (symbol === Clutter.KEY_Left) {
          change(-step);
          return Clutter.EVENT_STOP;
        }
        if (symbol === Clutter.KEY_Right) {
          change(step);
          return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
      });
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
        opacity: 170,
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
      return { item, value: value as unknown as { text: string } };
    };

    addSwitch(
      _("Enable guard"),
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
    addSpinRow(_("Max retained"), "screenshot-max-count", 1, "", _("Unlimited"));
    addSpinRow(_("Expire after"), "screenshot-expire-seconds", 1, " s", _("Off"));
    addSpinRow(_("Memory budget"), "screenshot-memory-budget-mb", 8, " MiB", _("Off"));
    addSpinRow(_("Hard cap"), "emergency-hard-cap", 8, "", _("Off"));
    const statsSeparator = new PopupMenu.PopupSeparatorMenuItem();
    menu.addMenuItem(statsSeparator);

    const keptRow = addStatRow(_("Kept notifications"));
    const memoryRow = addStatRow(_("Thumbnail memory / peak"));
    const rssRow = addStatRow(_("Shell memory"));
    const prunedRow = addStatRow(_("Pruned"));
    const statsRows = [keptRow, memoryRow, rssRow, prunedRow];

    const setStatsVisible = (visible: boolean): void => {
      for (const row of statsRows) (row.item as { visible: boolean }).visible = visible;
      (statsSeparator as { visible: boolean }).visible = visible;
    };
    watch("show-stats", () => setStatsVisible(settings.get_boolean("show-stats")));
    setStatsVisible(settings.get_boolean("show-stats"));
    const clearItem = new PopupMenu.PopupMenuItem(
      _("Clear screenshot notifications"),
    ) as unknown as MenuItem;
    // Intentionally stays open so the stats rows show the result immediately.
    clearItem.connect("activate", () => {
      try {
        engine.clearScreenshots();
      } catch (e) {
        log.err("tray", "clear failed", e);
      }
    });
    menu.addMenuItem(clearItem);

    const prefsItem = new PopupMenu.PopupMenuItem(_("Extension settings…")) as unknown as MenuItem;
    prefsItem.connect("activate", () => {
      menu.close(BoxPointer.PopupAnimation.FULL);
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
        if (args[1]) for (const refresh of refreshers) refresh();
      } catch (e) {
        log.err("tray", "refresh failed", e);
      }
    });
    disposables.add(() => {
      try {
        menu.disconnect(openId);
      } catch {
        // Already gone.
      }
    });

    const dateMenu = adapter.getDateMenuMenu();
    if (dateMenu && typeof (dateMenu as Emitter).connect === "function") {
      const emitter = dateMenu as Emitter;
      const dateOpenId = emitter.connect("open-state-changed", (...args: unknown[]) => {
        try {
          if (args[1] && settings.get_boolean("clear-on-panel-open")) engine.clearScreenshots();
        } catch (e) {
          log.err("tray", "clear-on-panel-open failed", e);
        }
      });
      disposables.add(() => {
        try {
          emitter.disconnect(dateOpenId);
        } catch {
          // Already gone.
        }
      });
    }

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
