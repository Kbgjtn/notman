import Gio from "gi://Gio";
import GLib from "gi://GLib";

import type { Disposables } from "./disposables.js";
import type { Engine } from "./engine.js";
import { log } from "./log.js";

export const DBUS_BUS_NAME = "org.gnome.Shell.Extensions.Notman";
export const DBUS_OBJECT_PATH = "/org/gnome/Shell/Extensions/Notman";

export enum DbusMethod {
  GetStats = "GetStats",
  ClearScreenshots = "ClearScreenshots",
  SetGuardEnabled = "SetGuardEnabled",
  SetScreenshotNotifyEnabled = "SetScreenshotNotifyEnabled",
  SetMaxCount = "SetMaxCount",
}

const XML = `
<node>
  <interface name="${DBUS_BUS_NAME}">
    <method name="${DbusMethod.GetStats}">
      <arg type="a{sv}" name="stats" direction="out"/>
    </method>
    <method name="${DbusMethod.ClearScreenshots}"/>
    <method name="${DbusMethod.SetGuardEnabled}">
      <arg type="b" name="enabled" direction="in"/>
    </method>
    <method name="${DbusMethod.SetScreenshotNotifyEnabled}">
      <arg type="b" name="enabled" direction="in"/>
    </method>
    <method name="${DbusMethod.SetMaxCount}">
      <arg type="i" name="count" direction="in"/>
    </method>
  </interface>
</node>`;

/** Exposes the screenshot rule to scripts and preferences. Returns true on success. */
export function registerDbus(engine: Engine, disposables: Disposables): boolean {
  let interfaceInfo: Gio.DBusInterfaceInfo;
  try {
    const node = Gio.DBusNodeInfo.new_for_xml(XML);
    const lookedUp = node.lookup_interface(DBUS_BUS_NAME);
    if (!lookedUp) throw new Error("interface missing from generated node info");
    interfaceInfo = lookedUp;
  } catch (e) {
    log.err("dbus", "invalid D-Bus interface XML", e);
    return false;
  }

  let stopped = false;
  let ownerId = 0;
  try {
    ownerId = Gio.bus_own_name(
      Gio.BusType.SESSION,
      DBUS_BUS_NAME,
      Gio.BusNameOwnerFlags.NONE,
      (connection) => {
        // bus_acquired is asynchronous; teardown may have happened already.
        if (stopped) return;
        try {
          const registrationId = connection.register_object(
            DBUS_OBJECT_PATH,
            interfaceInfo,
            (
              _connection: Gio.DBusConnection,
              _sender: string,
              _path: string,
              _interface: string,
              method: string,
              params: GLib.Variant,
              invocation: Gio.DBusMethodInvocation,
            ) => {
              try {
                switch (method) {
                  case DbusMethod.GetStats: {
                    const stats = engine.getStats();
                    const dict: Record<string, GLib.Variant> = {
                      activeCount: new GLib.Variant("i", stats.activeCount),
                      estimatedBytes: new GLib.Variant("x", stats.estimatedBytes),
                      peakBytes: new GLib.Variant("x", stats.peakBytes),
                      prunedCount: new GLib.Variant("i", stats.prunedCount),
                      savedBytes: new GLib.Variant("x", stats.savedBytes),
                      shellRssBytes: new GLib.Variant("x", stats.shellRssBytes),
                      adapterId: new GLib.Variant("s", stats.adapterId),
                      tier: new GLib.Variant("i", stats.tier),
                    };
                    const result = new GLib.Variant("(a{sv})", [dict]);
                    invocation.return_value(
                      result as unknown as Parameters<typeof invocation.return_value>[0],
                    );
                    break;
                  }
                  case DbusMethod.ClearScreenshots:
                    engine.clearScreenshots();
                    invocation.return_value(null);
                    break;
                  case DbusMethod.SetGuardEnabled: {
                    const [enabled] = params.deepUnpack() as [boolean];
                    engine.setGuardEnabled(enabled);
                    invocation.return_value(null);
                    break;
                  }
                  case DbusMethod.SetScreenshotNotifyEnabled: {
                    const [enabled] = params.deepUnpack() as [boolean];
                    engine.setNotifyEnabled(enabled);
                    invocation.return_value(null);
                    break;
                  }
                  case DbusMethod.SetMaxCount: {
                    const [count] = params.deepUnpack() as [number];
                    engine.setMaxCount(count);
                    invocation.return_value(null);
                    break;
                  }
                  default:
                    invocation.return_dbus_error(
                      "org.freedesktop.DBus.Error.UnknownMethod",
                      `Unknown method: ${method}`,
                    );
                }
              } catch (e) {
                log.err("dbus", `method ${method} failed`, e);
                try {
                  invocation.return_dbus_error(
                    "org.freedesktop.DBus.Error.InvalidArgs",
                    `Invalid arguments for ${method}`,
                  );
                } catch {
                  // Reply already sent.
                }
              }
            },
            null,
            null,
          );
          disposables.add(() => {
            try {
              connection.unregister_object(registrationId);
            } catch {
              // Connection may already be closed.
            }
          });
        } catch (e) {
          log.err("dbus", "object registration failed", e);
        }
      },
      null,
      () => {},
    );
  } catch (e) {
    log.err("dbus", "name acquisition failed", e);
    return false;
  }

  disposables.add(() => {
    stopped = true;
    if (ownerId !== 0) Gio.bus_unown_name(ownerId);
  });
  return ownerId !== 0;
}
