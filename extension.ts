import Gio from "gi://Gio";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";

import { detectAdapter } from "./src/compat/adapter.js";
import { registerDbus } from "./src/dbus.js";
import { Disposables } from "./src/disposables.js";
import { Engine } from "./src/engine.js";
import { GlibScheduler } from "./src/glib-scheduler.js";
import { log } from "./src/log.js";
import { QuietHoursController } from "./src/quiet-hours.js";
import { parseIndicatorPosition, SettingKey, SettingsStore } from "./src/settings.js";
import { ShellBridge } from "./src/shell-bridge.js";
import { CapabilityTier, type IndicatorPosition, type SignalEmitter } from "./src/types.js";
import { TrayIndicator } from "./src/ui/tray.js";

export default class NotmanExtension extends Extension {
  private _engine: Engine | null = null;
  private _disposables: Disposables | null = null;

  enable(): void {
    if (this._engine || this._disposables) this.disable();
    const disposables = new Disposables();
    this._disposables = disposables;

    try {
      const adapter = detectAdapter();
      if (!adapter) {
        log.info("extension", "unsupported GNOME Shell version");
        return;
      }

      const capabilities = adapter.probe();
      if (!capabilities.tray) {
        log.info("extension", "message tray unavailable, guard not enabled");
        return;
      }

      const rawSettings = this.getSettings();
      const syncDebugLogging = (): void => {
        try {
          log.setDebugEnabled(rawSettings.get_boolean(SettingKey.DebugLogging));
        } catch (e) {
          log.err("extension", `could not read ${SettingKey.DebugLogging}`, e);
        }
      };
      syncDebugLogging();
      const debugId = rawSettings.connect(`changed::${SettingKey.DebugLogging}`, syncDebugLogging);
      disposables.add(() => {
        try {
          rawSettings.disconnect(debugId);
        } catch {
          // Settings may already be gone.
        }
      });

      log.debug(
        "extension",
        `enable adapter=${adapter.id} tray=${capabilities.tray} topBar=${capabilities.topBar} dateMenu=${capabilities.dateMenu}`,
      );

      const settings = new SettingsStore(rawSettings);
      disposables.add(() => settings.dispose());

      const bridge = ShellBridge.create(adapter, capabilities, disposables);
      if (!bridge) {
        this.disable();
        log.info("extension", "shell bridge unavailable, guard not enabled");
        return;
      }

      const tier = capabilities.topBar ? CapabilityTier.TopBar : CapabilityTier.Headless;
      const scheduler = new GlibScheduler();
      const engine = new Engine(settings, bridge, adapter.id, tier, scheduler);
      if (!engine.start()) {
        this.disable();
        log.info("extension", "engine failed to start");
        return;
      }
      this._engine = engine;

      // Scheduled Do Not Disturb (Quiet hours).
      try {
        const desktopNotifications = new Gio.Settings({
          schema_id: "org.gnome.desktop.notifications",
        });
        const quietHours = new QuietHoursController(
          () => ({
            enabled: rawSettings.get_boolean(SettingKey.QuietHoursEnabled),
            start: rawSettings.get_string(SettingKey.QuietHoursStart),
            end: rawSettings.get_string(SettingKey.QuietHoursEnd),
          }),
          {
            getShowBanners: () => desktopNotifications.get_boolean("show-banners"),
            setShowBanners: (show) => desktopNotifications.set_boolean("show-banners", show),
          },
          scheduler,
        );
        quietHours.start();
        const quietIds = [
          rawSettings.connect(`changed::${SettingKey.QuietHoursEnabled}`, () => quietHours.sync()),
          rawSettings.connect(`changed::${SettingKey.QuietHoursStart}`, () => quietHours.sync()),
          rawSettings.connect(`changed::${SettingKey.QuietHoursEnd}`, () => quietHours.sync()),
        ];
        disposables.add(() => {
          for (const id of quietIds) {
            try {
              rawSettings.disconnect(id);
            } catch {
              // Settings may already be gone.
            }
          }
          quietHours.stop();
        });
      } catch (e) {
        log.warn("extension", `quiet hours unavailable: ${String(e)}`);
      }

      // Clear screenshot notifications when the notification list opens, if enabled.
      const dateMenu = adapter.getDateMenuMenu() as SignalEmitter | null;
      if (dateMenu && typeof dateMenu.connect === "function") {
        const dateOpenId = dateMenu.connect("open-state-changed", (...args: unknown[]) => {
          try {
            if (args[1] && rawSettings.get_boolean(SettingKey.ClearOnPanelOpen)) {
              engine.clearScreenshots();
            }
          } catch (e) {
            log.err("extension", `${SettingKey.ClearOnPanelOpen} failed`, e);
          }
        });
        disposables.add(() => {
          try {
            dateMenu.disconnect(dateOpenId);
          } catch {
            // Menu may already be gone.
          }
        });
      }

      // Dynamically show, hide, or reposition the top-bar indicator.
      if (capabilities.topBar) {
        let indicator: TrayIndicator | null = null;
        let currentPosition: IndicatorPosition | null = null;
        let currentIndex: number | null = null;
        const syncIndicator = (): void => {
          try {
            const wantIndicator = rawSettings.get_boolean(SettingKey.ShowIndicator);
            const position = parseIndicatorPosition(
              rawSettings.get_string(SettingKey.IndicatorPosition),
            );
            const index = Math.max(0, rawSettings.get_int(SettingKey.IndicatorIndex));
            if (!wantIndicator) {
              if (indicator) {
                indicator.destroy();
                indicator = null;
                currentPosition = null;
                currentIndex = null;
              }
              return;
            }
            if (indicator && currentPosition === position && currentIndex === index) return;
            if (indicator) {
              indicator.destroy();
              indicator = null;
            }
            indicator = TrayIndicator.create(
              this.uuid,
              rawSettings,
              engine,
              () => this.openPreferences(),
              position,
              index,
            );
            currentPosition = indicator ? position : null;
            currentIndex = indicator ? index : null;
          } catch (e) {
            log.err("extension", "indicator sync failed", e);
          }
        };
        syncIndicator();
        const indicatorSettingIds = [
          rawSettings.connect(`changed::${SettingKey.ShowIndicator}`, syncIndicator),
          rawSettings.connect(`changed::${SettingKey.IndicatorPosition}`, syncIndicator),
          rawSettings.connect(`changed::${SettingKey.IndicatorIndex}`, syncIndicator),
        ];
        disposables.add(() => {
          for (const id of indicatorSettingIds) {
            try {
              rawSettings.disconnect(id);
            } catch {
              // Settings may already be gone.
            }
          }
          indicator?.destroy();
          indicator = null;
        });
      }

      if (!registerDbus(engine, disposables)) {
        log.warn("extension", "D-Bus API unavailable, guard still active");
      }
      log.info("extension", `enabled adapter=${adapter.id} tier=${tier}`);
    } catch (e) {
      log.err("extension", "enable failed", e);
      this.disable();
    }
  }

  disable(): void {
    try {
      this._engine?.stop();
    } catch (e) {
      log.err("extension", "engine stop failed", e);
    }
    try {
      this._disposables?.dispose();
    } catch (e) {
      log.err("extension", "teardown failed", e);
    }
    this._engine = null;
    this._disposables = null;
    log.setDebugEnabled(false);
  }
}
