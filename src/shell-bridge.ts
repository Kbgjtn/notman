import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

import type { AdapterCapabilities, ShellAdapter } from './compat/adapter.js';
import type { Disposables } from './disposables.js';
import { logErr } from './log.js';
import type { NotificationHandle } from './types.js';

type SignalEmitter = {
  connect(signal: string, callback: (...args: unknown[]) => void): number;
  disconnect(id: number): void;
};

type TrayLike = SignalEmitter & { getSources(): unknown[] };

type NotificationLike = SignalEmitter & {
  urgency: number;
  forFeedback: boolean;
  isTransient: boolean;
  gicon: unknown;
  destroy(reason?: number): void;
};

export interface Bridge {
  readonly capabilities: AdapterCapabilities;
  start(
    onAdded: (notification: unknown) => void,
    onDestroyed: (notification: unknown) => void,
  ): boolean;
  sourceKeyFor(notification: unknown): string;
  makeHandle(notification: unknown, sourceKey: string): NotificationHandle | null;
  idFor(notification: unknown): number | null;
  currentlyShownId(): number | null;
  readRssBytes(): number;
  stop(): void;
}

export function createBridge(
  adapter: ShellAdapter,
  capabilities: AdapterCapabilities,
  disposables: Disposables,
): Bridge | null {
  const tray = Main.messageTray as unknown as TrayLike | null;
  if (!capabilities.tray || !tray || typeof tray.getSources !== 'function') return null;

  const ids = new WeakMap<object, number>();
  const destroyed = new WeakSet<object>();
  const downgraded = new WeakSet<object>();
  const seenSources = new WeakSet<object>();
  const pendingDestroys = new Set<number>();
  let nextId = 1;
  let stopped = false;

  const idFor = (notification: unknown): number | null => {
    if (!notification || typeof notification !== 'object') return null;
    return ids.get(notification) ?? null;
  };

  const estimateBytes = (icon: unknown): number => {
    if (!icon || typeof icon !== 'object') return 0;
    const sized = icon as { get_preferred_size?: () => unknown };
    if (typeof sized.get_preferred_size !== 'function') return 0;
    try {
      const size = sized.get_preferred_size();
      if (Array.isArray(size) && size.length >= 2) {
        const width = Number(size[0]);
        const height = Number(size[1]);
        if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0)
          return Math.round(width * height * 4);
      }
    } catch {
      // Unknown icon implementation: fall back to count-only accounting.
    }
    return 0;
  };

  const decode = (bytes: Uint8Array): string => {
    try {
      return new TextDecoder('utf-8').decode(bytes);
    } catch {
      let text = '';
      for (const byte of bytes) text += String.fromCharCode(byte);
      return text;
    }
  };

  const makeHandle = (notification: unknown, sourceKey: string): NotificationHandle | null => {
    if (!notification || typeof notification !== 'object') return null;
    const target = notification as NotificationLike;
    let id = ids.get(target);
    if (id === undefined) {
      id = nextId++;
      ids.set(target, id);
    }
    return {
      id,
      sourceKey,
      receivedAtMs: Date.now(),
      estimatedBytes: estimateBytes(target.gicon),
      isCritical: target.urgency === MessageTray.Urgency.CRITICAL,
      forFeedback: !!target.forFeedback,
      isTransient: !!target.isTransient,
      isDowngraded: () => downgraded.has(target),
      downgrade: () => {
        if (downgraded.has(target)) return;
        try {
          target.gicon = new Gio.ThemedIcon({
            name: 'screenshot-recorded-symbolic',
          });
          downgraded.add(target);
        } catch (e) {
          logErr(e, 'notman: could not downgrade thumbnail');
        }
      },
      destroy: () => {
        if (destroyed.has(target) || stopped) return;
        destroyed.add(target);
        const sourceId = GLib.idle_add(GLib.PRIORITY_LOW, () => {
          pendingDestroys.delete(sourceId);
          try {
            target.destroy(MessageTray.NotificationDestroyedReason.DISMISSED);
          } catch (e) {
            logErr(e, 'notman: could not destroy notification');
          }
          return GLib.SOURCE_REMOVE;
        });
        pendingDestroys.add(sourceId);
      },
    };
  };

  const attachNotification = (
    notification: unknown,
    onAdded: (notification: unknown) => void,
    onDestroyed: (notification: unknown) => void,
  ): void => {
    if (!notification || typeof notification !== 'object') return;
    const emitter = notification as SignalEmitter;
    if (typeof emitter.connect !== 'function') return;
    const signalId = emitter.connect('destroy', () => onDestroyed(notification));
    disposables.add(() => {
      try {
        emitter.disconnect(signalId);
      } catch {
        // Notification may already be gone.
      }
    });
    onAdded(notification);
  };

  const observeSource = (
    source: unknown,
    onAdded: (notification: unknown) => void,
    onDestroyed: (notification: unknown) => void,
  ): void => {
    if (!source || typeof source !== 'object' || seenSources.has(source)) return;
    seenSources.add(source);
    if (!adapter.isScreenshotSource(source)) return;
    const emitter = source as SignalEmitter;
    if (typeof emitter.connect !== 'function') return;
    const signalId = emitter.connect('notification-added', (...args: unknown[]) => {
      attachNotification(args[0], onAdded, onDestroyed);
    });
    disposables.add(() => {
      try {
        emitter.disconnect(signalId);
      } catch {
        // Source may already be gone.
      }
    });
  };

  return {
    capabilities,

    start(onAdded, onDestroyed) {
      const sourceAddedId = tray.connect('source-added', (...args: unknown[]) => {
        observeSource(args[0], onAdded, onDestroyed);
      });
      disposables.add(() => {
        try {
          tray.disconnect(sourceAddedId);
        } catch {
          // Tray may already be gone.
        }
      });
      for (const source of tray.getSources()) observeSource(source, onAdded, onDestroyed);
      return true;
    },

    sourceKeyFor(notification) {
      if (!notification || typeof notification !== 'object') return 'other';
      const source = (notification as { source?: unknown }).source;
      return adapter.isScreenshotSource(source) ? 'screenshot' : 'other';
    },

    makeHandle,
    idFor,

    currentlyShownId() {
      const shown = (Main.messageTray as unknown as { _notification?: unknown } | null)
        ?._notification;
      return shown ? idFor(shown) : null;
    },

    readRssBytes() {
      try {
        const [ok, contents] = Gio.File.new_for_path('/proc/self/status').load_contents(null);
        if (!ok) return 0;
        const match = /^VmRSS:\s+(\d+)\s+kB/m.exec(decode(contents));
        return match ? Number(match[1]) * 1024 : 0;
      } catch {
        return 0;
      }
    },

    stop() {
      stopped = true;
      for (const id of pendingDestroys) {
        try {
          GLib.source_remove(id);
        } catch {
          // Already fired.
        }
      }
      pendingDestroys.clear();
    },
  };
}
