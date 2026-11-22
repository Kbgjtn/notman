import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import type { Disposables } from './disposables.js';
import type { Engine } from './engine.js';
import { logErr } from './log.js';

const BUS_NAME = 'org.gnome.Shell.Extensions.NotificationTuner';
const OBJECT_PATH = '/org/gnome/Shell/Extensions/NotificationTuner';

const XML = `
<node>
  <interface name="${BUS_NAME}">
    <method name="GetStats">
      <arg type="a{sv}" name="stats" direction="out"/>
    </method>
    <method name="ClearScreenshots"/>
    <method name="SetEnabled">
      <arg type="b" name="enabled" direction="in"/>
    </method>
    <method name="SetMaxCount">
      <arg type="i" name="count" direction="in"/>
    </method>
  </interface>
</node>`;

/** Exposes the screenshot rule to scripts. Returns true on success. */
export function registerDbus(engine: Engine, disposables: Disposables): boolean {
  let interfaceInfo: Gio.DBusInterfaceInfo;
  try {
    const node = Gio.DBusNodeInfo.new_for_xml(XML);
    const lookedUp = node.lookup_interface(BUS_NAME);
    if (!lookedUp) throw new Error('interface missing from generated node info');
    interfaceInfo = lookedUp;
  } catch (e) {
    logErr(e, 'notman: invalid D-Bus interface XML');
    return false;
  }

  const ownerId = Gio.bus_own_name(
    Gio.BusType.SESSION,
    BUS_NAME,
    Gio.BusNameOwnerFlags.NONE,
    (connection) => {
      try {
        const registrationId = connection.register_object(
          OBJECT_PATH,
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
            switch (method) {
              case 'GetStats': {
                const stats = engine.getStats();
                const dict: Record<string, GLib.Variant> = {
                  activeCount: new GLib.Variant('i', stats.activeCount),
                  estimatedBytes: new GLib.Variant('x', stats.estimatedBytes),
                  peakBytes: new GLib.Variant('x', stats.peakBytes),
                  prunedCount: new GLib.Variant('i', stats.prunedCount),
                  shellRssBytes: new GLib.Variant('x', stats.shellRssBytes),
                  adapterId: new GLib.Variant('s', stats.adapterId),
                  tier: new GLib.Variant('i', stats.tier),
                };
                const result = new GLib.Variant('(a{sv})', [dict]);
                invocation.return_value(
                  result as unknown as Parameters<typeof invocation.return_value>[0],
                );
                break;
              }
              case 'ClearScreenshots':
                engine.clearScreenshots();
                invocation.return_value(null);
                break;
              case 'SetEnabled': {
                const [enabled] = params.deepUnpack() as [boolean];
                engine.setEnabled(enabled);
                invocation.return_value(null);
                break;
              }
              case 'SetMaxCount': {
                const [count] = params.deepUnpack() as [number];
                engine.setMaxCount(count);
                invocation.return_value(null);
                break;
              }
              default:
                invocation.return_dbus_error(
                  'org.freedesktop.DBus.Error.UnknownMethod',
                  `Unknown method: ${method}`,
                );
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
        logErr(e, 'notman: D-Bus object registration failed');
      }
    },
    null,
    () => {},
  );

  disposables.add(() => Gio.bus_unown_name(ownerId));
  return ownerId !== 0;
}
