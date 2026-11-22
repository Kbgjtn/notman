import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";

import { detectAdapter } from "./src/compat/adapter.js";
import { registerDbus } from "./src/dbus.js";
import { Disposables } from "./src/disposables.js";
import { Engine } from "./src/engine.js";
import { GlibScheduler } from "./src/glib-scheduler.js";
import { log } from "./src/log.js";
import { SettingsStore } from "./src/settings.js";
import { createBridge } from "./src/shell-bridge.js";
import { createPanelUi, type PanelUi } from "./src/ui/panel.js";

export default class NotmanExtension extends Extension {
  private _engine: Engine | null = null;
  private _disposables: Disposables | null = null;
  private _panel: PanelUi | null = null;

  enable(): void {
    try {
      const versions = this.metadata["shell-version"] as string[] | undefined;
      const version = versions?.[0] ?? "";
      const adapter = detectAdapter(version);
      if (!adapter) {
        log.info("extension", `unsupported shell version '${version}'`);
        return;
      }

      const capabilities = adapter.probe();
      if (!capabilities.tray) {
        log.info("extension", "message tray unavailable, guard not enabled");
        return;
      }

      const rawSettings = this.getSettings();
      try {
        log.setDebugEnabled(rawSettings.get_boolean("debug-logging"));
      } catch (e) {
        log.err("extension", "could not read debug-logging", e);
      }
      log.debug(
        "extension",
        `enable adapter=${adapter.id} tray=${capabilities.tray} panel=${capabilities.panel}`,
      );

      const settings = new SettingsStore(rawSettings);
      const disposables = new Disposables();
      this._disposables = disposables;
      const bridge = createBridge(adapter, capabilities, disposables);
      if (!bridge) {
        disposables.dispose();
        log.info("extension", "shell bridge unavailable, guard not enabled");
        return;
      }

      const tier = capabilities.panel ? 2 : 1;
      const engine = new Engine(settings, bridge, adapter.id, tier, new GlibScheduler());
      if (!engine.start()) {
        disposables.dispose();
        log.info("extension", "engine failed to start");
        return;
      }

      // Publish references before registering D-Bus: its callback is
      // asynchronous and a failure must still be fully teardown-able.
      this._engine = engine;
      this._disposables = disposables;
      if (capabilities.panel)
        this._panel = createPanelUi(adapter, rawSettings, engine, disposables);
      if (!registerDbus(engine, disposables))
        log.warn("extension", "D-Bus API unavailable, guard still active");
      log.info("extension", `enabled adapter=${adapter.id} tier=${tier}`);
    } catch (e) {
      log.err("extension", "enable failed", e);
      this.disable();
    }
  }

  disable(): void {
    try {
      this._panel?.destroy();
    } catch (e) {
      log.err("extension", "panel destroy failed", e);
    }
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
    this._panel = null;
    log.setDebugEnabled(false);
  }
}
