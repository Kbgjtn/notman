import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";

import { detectAdapter } from "./src/compat/adapter.js";
import { registerDbus } from "./src/dbus.js";
import { Disposables } from "./src/disposables.js";
import { Engine } from "./src/engine.js";
import { GlibScheduler } from "./src/glib-scheduler.js";
import { logErr } from "./src/log.js";
import { SettingsStore } from "./src/settings.js";
import { createBridge } from "./src/shell-bridge.js";

export default class NotmanExtension extends Extension {
  private _engine: Engine | null = null;
  private _disposables: Disposables | null = null;

  enable(): void {
    try {
      const versions = this.metadata["shell-version"] as string[] | undefined;
      const version = versions?.[0] ?? "";
      const adapter = detectAdapter(version);
      if (!adapter) {
        log(`notman: unsupported shell version '${version}', guard not enabled`);
        return;
      }

      const capabilities = adapter.probe();
      if (!capabilities.tray) {
        log("notman: message tray unavailable, guard not enabled");
        return;
      }

      const settings = new SettingsStore(this.getSettings());
      const disposables = new Disposables();
      const bridge = createBridge(adapter, capabilities, disposables);
      if (!bridge) {
        disposables.dispose();
        log("notman: shell bridge unavailable, guard not enabled");
        return;
      }

      const tier = capabilities.panel ? 2 : 1;
      const engine = new Engine(settings, bridge, adapter.id, tier, new GlibScheduler());
      if (!engine.start()) {
        disposables.dispose();
        log("notman: engine failed to start");
        return;
      }

      // Publish the references before registering D-Bus: its callback is
      // asynchronous and a failure must still be fully teardown-able.
      this._engine = engine;
      this._disposables = disposables;
      if (!registerDbus(engine, disposables))
        log("notman: D-Bus API unavailable, guard still active");
      log(`notman: enabled (adapter=${adapter.id}, tier=${tier})`);
    } catch (e) {
      logErr(e, "notman: enable failed");
      this.disable();
    }
  }

  disable(): void {
    try {
      this._engine?.stop();
    } catch (e) {
      logErr(e, "notman: engine stop failed");
    }
    try {
      this._disposables?.dispose();
    } catch (e) {
      logErr(e, "notman: teardown failed");
    }
    this._engine = null;
    this._disposables = null;
  }
}
