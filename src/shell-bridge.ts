import Cogl from "gi://Cogl";
import GdkPixbuf from "gi://GdkPixbuf";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import St from "gi://St";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

import { estimateContentBytes } from "./byte-estimate.js";
import type { AdapterCapabilities, ShellAdapter } from "./compat/adapter.js";
import type { Disposables } from "./disposables.js";
import { log } from "./log.js";
import { type NotificationHandle, type SignalEmitter, SourceKey } from "./types.js";

const COMPACT_MAX_SIDE = 128;
const MAX_IN_FLIGHT_COMPACTIONS = 3;

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
  adoptExisting(): void;
  sourceKeyFor(notification: unknown): SourceKey;
  makeHandle(notification: unknown, sourceKey: SourceKey): NotificationHandle | null;
  idFor(notification: unknown): number | null;
  currentlyShownId(): number | null;
  isDoNotDisturb(): boolean;
  readRssBytes(): number;
  stop(): void;
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    let text = "";
    for (const byte of bytes) text += String.fromCharCode(byte);
    return text;
  }
}

export class ShellBridge implements Bridge {
  private readonly _ids = new WeakMap<object, number>();
  private readonly _destroyed = new WeakSet<object>();
  private readonly _compacted = new WeakSet<object>();
  private readonly _compactBytes = new WeakMap<object, number>();
  private readonly _downgraded = new WeakSet<object>();
  private readonly _seenSources = new WeakSet<object>();
  private readonly _attachedNotifications = new WeakSet<object>();
  private readonly _pendingDestroys = new Set<number>();
  private readonly _pendingCancellables = new Set<Gio.Cancellable>();
  private readonly _cancellables = new WeakMap<object, Gio.Cancellable>();
  private _inFlightCompactions = 0;
  private _nextId = 1;
  private _stopped = false;
  private _onAdded: ((notification: unknown) => void) | null = null;
  private _onDestroyed: ((notification: unknown) => void) | null = null;
  private readonly _desktopNotifications: Gio.Settings | null;

  private constructor(
    private readonly _tray: TrayLike,
    private readonly _adapter: ShellAdapter,
    readonly capabilities: AdapterCapabilities,
    private readonly _disposables: Disposables,
  ) {
    let desktopNotifications: Gio.Settings | null = null;
    try {
      desktopNotifications = new Gio.Settings({
        schema_id: "org.gnome.desktop.notifications",
      });
    } catch (e) {
      log.debug("bridge", `could not open org.gnome.desktop.notifications: ${String(e)}`);
    }
    this._desktopNotifications = desktopNotifications;
  }

  static create(
    adapter: ShellAdapter,
    capabilities: AdapterCapabilities,
    disposables: Disposables,
  ): ShellBridge | null {
    const tray = Main.messageTray as unknown as TrayLike | null;
    if (!capabilities.tray || !tray || typeof tray.getSources !== "function") return null;
    return new ShellBridge(tray, adapter, capabilities, disposables);
  }

  start(
    onAdded: (notification: unknown) => void,
    onDestroyed: (notification: unknown) => void,
  ): boolean {
    this._onAdded = onAdded;
    this._onDestroyed = onDestroyed;
    log.debug("bridge", `start sources=${this._tray.getSources().length}`);

    const sourceAddedId = this._tray.connect(
      this._adapter.signals.sourceAdded,
      (...args: unknown[]) => {
        log.debug("bridge", "source-added signal received");
        // GJS passes the emitter as args[0]; the source is args[1].
        this.observeSource(args[1]);
      },
    );
    this._disposables.add(() => {
      try {
        this._tray.disconnect(sourceAddedId);
      } catch {
        // Tray may already be gone.
      }
    });

    for (const source of this._tray.getSources()) this.observeSource(source);
    return true;
  }

  adoptExisting(): void {
    if (this._stopped || !this._onAdded || !this._onDestroyed) return;
    for (const source of this._tray.getSources()) this.observeSource(source);
  }

  sourceKeyFor(notification: unknown): SourceKey {
    if (!notification || typeof notification !== "object") return SourceKey.Other;
    const source = (notification as { source?: unknown }).source;
    if (this._adapter.isScreenshotSource(source)) return SourceKey.Screenshot;
    if (this._adapter.isScreencastSource(source)) return SourceKey.Screencast;
    return SourceKey.Other;
  }

  idFor(notification: unknown): number | null {
    if (!notification || typeof notification !== "object") return null;
    return this._ids.get(notification) ?? null;
  }

  makeHandle(notification: unknown, sourceKey: SourceKey): NotificationHandle | null {
    if (!notification || typeof notification !== "object") return null;
    const target = notification as NotificationLike;
    let id = this._ids.get(target);
    if (id === undefined) {
      id = this._nextId++;
      this._ids.set(target, id);
    }

    const initialBytes = estimateContentBytes(target.gicon);
    const isCritical = target.urgency === this._adapter.criticalUrgency();
    const isTransient = Boolean(target.isTransient);
    const downgraded = this._downgraded;
    const compactBytes = this._compactBytes;
    const downgrade = (): void => {
      this.cancelCompaction(target);
      if (this._downgraded.has(target)) return;
      try {
        target.gicon = new Gio.ThemedIcon({ name: "screenshot-recorded-symbolic" });
        this._downgraded.add(target);
      } catch (e) {
        log.err("bridge", "could not downgrade thumbnail", e);
      }
    };
    log.debug(
      "bridge",
      `handle id=${id} sourceKey=${sourceKey} bytes=${initialBytes} critical=${isCritical} transient=${isTransient}`,
    );

    return {
      id,
      sourceKey,
      receivedAtMs: Date.now(),
      get estimatedBytes(): number {
        if (downgraded.has(target)) return 0;
        return compactBytes.get(target) ?? initialBytes;
      },
      isCritical,
      forFeedback: Boolean(target.forFeedback),
      isTransient,
      isCompacted: (): boolean => this._compacted.has(target),
      compact: (): void => {
        if (
          this._compacted.has(target) ||
          this._downgraded.has(target) ||
          this._destroyed.has(target) ||
          this._stopped
        ) {
          return;
        }
        this._compacted.add(target);
        if (this._inFlightCompactions >= MAX_IN_FLIGHT_COMPACTIONS) {
          log.debug(
            "bridge",
            `compact id=${id}: burst limit (${MAX_IN_FLIGHT_COMPACTIONS}) reached, falling back to text-only`,
          );
          downgrade();
          return;
        }
        this._inFlightCompactions++;
        let released = false;
        const release = (): void => {
          if (released) return;
          released = true;
          this._inFlightCompactions = Math.max(0, this._inFlightCompactions - 1);
        };
        try {
          const clipboard = St.Clipboard.get_default();
          clipboard.get_content(St.ClipboardType.CLIPBOARD, "image/png", (_clipboard, bytes) => {
            if (this._stopped || this._destroyed.has(target) || this._downgraded.has(target)) {
              release();
              return;
            }
            if (!bytes || bytes.get_size() === 0) {
              release();
              log.debug(
                "bridge",
                `compact id=${id}: clipboard has no PNG, falling back to text-only`,
              );
              downgrade();
              return;
            }
            try {
              const stream = Gio.MemoryInputStream.new_from_bytes(bytes as never);
              const cancellable = new Gio.Cancellable();
              this._pendingCancellables.add(cancellable);
              this._cancellables.set(target, cancellable);
              GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(
                stream as never,
                COMPACT_MAX_SIDE,
                COMPACT_MAX_SIDE,
                true,
                cancellable as never,
                (_source, result) => {
                  this._pendingCancellables.delete(cancellable);
                  if (this._cancellables.get(target) === cancellable) {
                    this._cancellables.delete(target);
                  }
                  release();
                  if (
                    this._stopped ||
                    this._destroyed.has(target) ||
                    this._downgraded.has(target)
                  ) {
                    return;
                  }
                  try {
                    const pixbuf = GdkPixbuf.Pixbuf.new_from_stream_finish(result);
                    const width = pixbuf.get_width();
                    const height = pixbuf.get_height();
                    const hasAlpha = pixbuf.get_has_alpha();
                    const rowstride = pixbuf.get_rowstride();
                    const pixelBytes = pixbuf.read_pixel_bytes();
                    const content = new St.ImageContent({
                      preferred_width: width,
                      preferred_height: height,
                    });
                    const pixelFormat = hasAlpha
                      ? Cogl.PixelFormat.RGBA_8888
                      : Cogl.PixelFormat.RGB_888;
                    const ok = content.set_bytes(
                      pixelBytes as never,
                      pixelFormat,
                      width,
                      height,
                      rowstride,
                    );
                    if (!ok) {
                      log.debug(
                        "bridge",
                        `compact id=${id}: set_bytes returned false, falling back to text-only`,
                      );
                      downgrade();
                      return;
                    }
                    target.gicon = content;
                    const bytesEstimate = estimateContentBytes(content) || width * height * 4;
                    this._compactBytes.set(target, bytesEstimate);
                    log.debug(
                      "bridge",
                      `compacted id=${id} ${width}x${height} bytes=${bytesEstimate}`,
                    );
                  } catch (e) {
                    if (cancellable.is_cancelled()) return;
                    log.debug(
                      "bridge",
                      `compact id=${id}: decode failed, falling back to text-only (${String(e)})`,
                    );
                    downgrade();
                  }
                },
              );
            } catch (e) {
              release();
              log.debug(
                "bridge",
                `compact id=${id}: stream setup failed, falling back to text-only (${String(e)})`,
              );
              downgrade();
            }
          });
        } catch (e) {
          release();
          log.debug(
            "bridge",
            `compact id=${id}: clipboard read failed, falling back to text-only (${String(e)})`,
          );
          downgrade();
        }
      },
      isDowngraded: (): boolean => this._downgraded.has(target),
      downgrade,
      destroy: (): boolean => {
        if (this._destroyed.has(target) || this._stopped) return false;
        this.cancelCompaction(target);
        log.debug("bridge", `destroy scheduled for id=${id}`);
        const sourceId = GLib.idle_add(GLib.PRIORITY_LOW, () => {
          this._pendingDestroys.delete(sourceId);
          try {
            target.destroy(this._adapter.dismissedReason());
          } catch (e) {
            log.err("bridge", "could not destroy notification", e);
          }
          return GLib.SOURCE_REMOVE;
        });
        if (sourceId === 0) return false;
        this._destroyed.add(target);
        this._pendingDestroys.add(sourceId);
        return true;
      },
    };
  }

  currentlyShownId(): number | null {
    for (const notification of this._adapter.getActiveNotifications()) {
      const id = this.idFor(notification);
      if (id !== null) return id;
    }
    return null;
  }

  isDoNotDisturb(): boolean {
    if (!this._desktopNotifications) return false;
    try {
      return !this._desktopNotifications.get_boolean("show-banners");
    } catch {
      return false;
    }
  }

  readRssBytes(): number {
    try {
      const [ok, contents] = Gio.File.new_for_path("/proc/self/status").load_contents(null);
      if (!ok) return 0;
      const match = /^VmRSS:\s+(\d+)\s+kB/m.exec(decodeUtf8(contents));
      return match ? Number(match[1]) * 1024 : 0;
    } catch {
      return 0;
    }
  }

  stop(): void {
    this._stopped = true;
    this._onAdded = null;
    this._onDestroyed = null;
    this._inFlightCompactions = 0;
    for (const cancellable of this._pendingCancellables) {
      try {
        cancellable.cancel();
      } catch {
        // Already completed.
      }
    }
    this._pendingCancellables.clear();
    for (const id of this._pendingDestroys) {
      try {
        GLib.source_remove(id);
      } catch {
        // Already fired.
      }
    }
    this._pendingDestroys.clear();
  }

  private cancelCompaction(target: object): void {
    const cancellable = this._cancellables.get(target);
    if (!cancellable) return;
    this._cancellables.delete(target);
    this._pendingCancellables.delete(cancellable);
    try {
      cancellable.cancel();
    } catch {
      // Already completed.
    }
  }

  private attachNotification(notification: unknown): void {
    if (!notification || typeof notification !== "object" || !this._onAdded || !this._onDestroyed) {
      return;
    }
    if (this._attachedNotifications.has(notification)) return;
    const emitter = notification as SignalEmitter;
    if (typeof emitter.connect !== "function") return;
    this._attachedNotifications.add(notification);

    const onAdded = this._onAdded;
    const onDestroyed = this._onDestroyed;
    const sourceKey = this.sourceKeyFor(notification);
    log.debug(
      "bridge",
      `notification attached sourceKey=${sourceKey} bytes=${estimateContentBytes((notification as { gicon?: unknown }).gicon)}`,
    );

    const signalId = emitter.connect(this._adapter.signals.destroy, () => {
      this._destroyed.add(notification);
      this.cancelCompaction(notification);
      this._disposables.remove(dispose);
      onDestroyed(notification);
    });
    const dispose = (): void => {
      try {
        emitter.disconnect(signalId);
      } catch {
        // Notification may already be gone.
      }
    };
    this._disposables.add(dispose);
    onAdded(notification);
  }

  private observeSource(source: unknown): void {
    if (!source || typeof source !== "object") return;
    if (!this._seenSources.has(source)) {
      this._seenSources.add(source);
      const matches = this._adapter.isScreenshotSource(source);
      log.debug(
        "bridge",
        `source title=${String((source as { title?: unknown }).title)} iconName=${String((source as { iconName?: unknown }).iconName)} screenshot=${matches}`,
      );

      const emitter = source as SignalEmitter;
      if (typeof emitter.connect === "function") {
        let addedId: number | null = emitter.connect(
          this._adapter.signals.notificationAdded,
          (...args: unknown[]) => {
            // GJS passes the emitter as args[0]; the notification is args[1].
            this.attachNotification(args[1]);
          },
        );
        let destroyId: number | null = null;
        const disposeSource = (): void => {
          this._disposables.remove(disposeSource);
          if (addedId !== null) {
            try {
              emitter.disconnect(addedId);
            } catch {
              // Source may already be gone.
            }
            addedId = null;
          }
          if (destroyId !== null) {
            try {
              emitter.disconnect(destroyId);
            } catch {
              // Source may already be gone.
            }
            destroyId = null;
          }
        };
        destroyId = emitter.connect(this._adapter.signals.destroy, disposeSource);
        this._disposables.add(disposeSource);
      }
    }

    const existing = (source as { notifications?: unknown[] }).notifications;
    if (Array.isArray(existing)) {
      for (const notification of existing) this.attachNotification(notification);
    }
  }
}
