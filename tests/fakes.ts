import type { Scheduler } from "../src/scheduler.js";
import type { SettingsStore } from "../src/settings.js";
import type { Bridge } from "../src/shell-bridge.js";
import type { NotificationHandle, RuleContext, RuleSettings } from "../src/types.js";

export function makeSettings(overrides: Partial<RuleSettings> = {}): RuleSettings {
  return {
    guardEnabled: true,
    notifyEnabled: true,
    thumbnailMode: "full",
    maxCount: 0,
    expireSeconds: 0,
    memoryBudgetMb: 0,
    emergencyHardCap: 0,
    ...overrides,
  };
}

export function makeContext(
  settings: RuleSettings,
  nowMs = 1_000_000,
  currentlyShownId: number | null = null,
): RuleContext {
  return { nowMs, settings, currentlyShownId, log: () => {} };
}

export class FakeHandle implements NotificationHandle {
  destroyed = false;
  downgraded = false;
  destroyCalls = 0;
  downgradeCalls = 0;
  private readonly _bytes: number;

  get estimatedBytes(): number {
    return this.downgraded ? 0 : this._bytes;
  }

  constructor(
    readonly id: number,
    readonly sourceKey: string,
    readonly receivedAtMs: number,
    estimatedBytes = 0,
    readonly isCritical = false,
    readonly forFeedback = false,
    readonly isTransient = true,
    readonly destroyThrows = false,
  ) {
    this._bytes = estimatedBytes;
  }

  isDowngraded(): boolean {
    return this.downgraded;
  }

  downgrade(): void {
    this.downgraded = true;
    this.downgradeCalls++;
  }

  destroy(): boolean {
    this.destroyCalls++;
    if (this.destroyThrows) throw new Error("destroy failed");
    this.destroyed = true;
    return true;
  }
}

export class FakeScheduler implements Scheduler {
  private readonly _callbacks = new Map<number, () => void>();
  private _nextId = 1;

  every(_intervalMs: number, callback: () => void): number {
    const id = this._nextId++;
    this._callbacks.set(id, callback);
    return id;
  }

  cancel(id: number): void {
    this._callbacks.delete(id);
  }

  tick(): void {
    for (const callback of [...this._callbacks.values()]) callback();
  }
}

export function makeSettingsStore(settings: RuleSettings): SettingsStore {
  const store = {
    read: () => settings,
    setNotifyEnabled: (value: boolean) => {
      settings.notifyEnabled = value;
    },
    setMaxCount: (value: number) => {
      settings.maxCount = value;
    },
  };
  return store as unknown as SettingsStore;
}

export function makeBridge(
  handles: Map<number, NotificationHandle>,
  byNotification: Map<unknown, number>,
): Bridge {
  return {
    capabilities: { tray: true, panel: true },
    start: () => true,
    sourceKeyFor: () => "screenshot",
    getExistingScreenshotNotifications: () => [],
    makeHandle: (notification) => {
      const id = byNotification.get(notification) ?? handles.size + 1;
      const handle = handles.get(id);
      if (handle) byNotification.set(notification, id);
      return handle ?? null;
    },
    idFor: (notification) => byNotification.get(notification) ?? null,
    currentlyShownId: () => null,
    readRssBytes: () => 0,
    stop: () => {},
  };
}
