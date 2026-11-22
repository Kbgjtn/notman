import Gio from "gi://Gio";
import GLib from "gi://GLib";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

import { estimateContentBytes } from "./byte-estimate.js";
import type { AdapterCapabilities, ShellAdapter } from "./compat/adapter.js";
import type { Disposables } from "./disposables.js";
import { logErr } from "./log.js";
import type { NotificationHandle } from "./types.js";

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
  if (!capabilities.tray || !tray || typeof tray.getSources !== "function") return null;

  const ids = new WeakMap<object, number>();
  const destroyed = new WeakSet<object>();
  const downgraded = new WeakSet<object>();
  const seenSources = new WeakSet<object>();
  const attachedNotifications = new WeakSet<object>();
  const pendingDestroys = new Set<number>();
  let nextId = 1;
  let stopped = false;

  const idFor = (notification: unknown): number | null => {
    if (!notification || typeof notification !== "object") return null;
    return ids.get(notification) ?? null;
  };

  const decode = (bytes: Uint8Array): string => {
    try {
      return new TextDecoder("utf-8").decode(bytes);
    } catch {
      let text = "";
      for (const byte of bytes) text += String.fromCharCode(byte);
      return text;
    }
  };

  const makeHandle = (notification: unknown, sourceKey: string): NotificationHandle | null => {
    if (!notification || typeof notification !== "object") return null;
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
      estimatedBytes: estimateContentBytes(target.gicon),
      isCritical: target.urgency === adapter.criticalUrgency(),
      forFeedback: !!target.forFeedback,
      isTransient: !!target.isTransient,
      isDowngraded: () => downgraded.has(target),
      downgrade: () => {
        if (downgraded.has(target)) return;
        try {
          target.gicon = new Gio.ThemedIcon({
            name: "screenshot-recorded-symbolic",
          });
          downgraded.add(target);
        } catch (e) {
          logErr(e, "notman: could not downgrade thumbnail");
        }
      },
      destroy: () => {
        if (destroyed.has(target) || stopped) return false;
        destroyed.add(target);
        const sourceId = GLib.idle_add(GLib.PRIORITY_LOW, () => {
          pendingDestroys.delete(sourceId);
          try {
            target.destroy(adapter.dismissedReason());
          } catch (e) {
            logErr(e, "notman: could not destroy notification");
          }
          return GLib.SOURCE_REMOVE;
        });
        if (sourceId === 0) return false;
        pendingDestroys.add(sourceId);
        return true;
      },
    };
  };

  const attachNotification = (
    notification: unknown,
    onAdded: (notification: unknown) => void,
    onDestroyed: (notification: unknown) => void,
  ): void => {
    if (!notification || typeof notification !== "object") return;
    if (attachedNotifications.has(notification)) return;
    const emitter = notification as SignalEmitter;
    if (typeof emitter.connect !== "function") return;
    attachedNotifications.add(notification);

    const signalId = emitter.connect(adapter.signals.destroy, () => {
      disposables.remove(dispose);
      onDestroyed(notification);
    });
    const dispose = (): void => {
      try {
        emitter.disconnect(signalId);
      } catch {
        // Notification may already be gone.
      }
    };
    disposables.add(dispose);
    onAdded(notification);
  };

  const observeSource = (
    source: unknown,
    onAdded: (notification: unknown) => void,
    onDestroyed: (notification: unknown) => void,
  ): void => {
    if (!source || typeof source !== "object" || seenSources.has(source)) return;
    seenSources.add(source);
    if (!adapter.isScreenshotSource(source)) return;
    const emitter = source as SignalEmitter;
    if (typeof emitter.connect !== "function") return;

    const signalId = emitter.connect(adapter.signals.notificationAdded, (...args: unknown[]) => {
      attachNotification(args[0], onAdded, onDestroyed);
    });
    disposables.add(() => {
      try {
        emitter.disconnect(signalId);
      } catch {
        // Source may already be gone.
      }
    });

    // Adopt notifications that existed before the extension was enabled.
    const existing = (source as { notifications?: unknown[] }).notifications;
    if (Array.isArray(existing)) {
      for (const notification of existing) attachNotification(notification, onAdded, onDestroyed);
    }
  };

  return {
    capabilities,

    start(onAdded, onDestroyed) {
      const sourceAddedId = tray.connect(adapter.signals.sourceAdded, (...args: unknown[]) => {
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
      if (!notification || typeof notification !== "object") return "other";
      const source = (notification as { source?: unknown }).source;
      return adapter.isScreenshotSource(source) ? "screenshot" : "other";
    },

    makeHandle,
    idFor,

    currentlyShownId() {
      for (const notification of adapter.getActiveNotifications()) {
        const id = idFor(notification);
        if (id !== null) return id;
      }
      return null;
    },

    readRssBytes() {
      try {
        const [ok, contents] = Gio.File.new_for_path("/proc/self/status").load_contents(null);
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
