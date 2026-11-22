import type { Scheduler } from "../src/scheduler.js";
import type { SettingsStore } from "../src/settings.js";
import type { Bridge } from "../src/shell-bridge.js";
import {
  type AppRuleEntry,
  type NotificationHandle,
  type RuleContext,
  type RuleSettings,
  SourceKey,
  ThumbnailMode,
} from "../src/types.js";

export interface MutableRuleSettings {
  guardEnabled: boolean;
  notifyEnabled: boolean;
  screencastNotifyEnabled: boolean;
  thumbnailMode: ThumbnailMode;
  maxCount: number;
  expireSeconds: number;
  memoryBudgetMb: number;
  emergencyHardCap: number;
  transientExpireEnabled: boolean;
  transientExpireSeconds: number;
  transientDndOnly: boolean;
  globalExpireMinutes: number;
  globalMaxCount: number;
  burstLimitEnabled: boolean;
  burstWindowSeconds: number;
  burstMaxPerSource: number;
  appRules: readonly AppRuleEntry[];
}

export function makeSettings(overrides: Partial<RuleSettings> = {}): MutableRuleSettings {
  return {
    guardEnabled: true,
    notifyEnabled: true,
    screencastNotifyEnabled: true,
    thumbnailMode: ThumbnailMode.Full,
    maxCount: 0,
    expireSeconds: 0,
    memoryBudgetMb: 0,
    emergencyHardCap: 0,
    transientExpireEnabled: false,
    transientExpireSeconds: 30,
    transientDndOnly: true,
    globalExpireMinutes: 0,
    globalMaxCount: 0,
    burstLimitEnabled: false,
    burstWindowSeconds: 10,
    burstMaxPerSource: 3,
    appRules: [],
    ...overrides,
  };
}

export function makeContext(
  settings: RuleSettings,
  nowMs = 1_000_000,
  currentlyShownId: number | null = null,
  isDoNotDisturb = true,
): RuleContext {
  return { nowMs, settings, currentlyShownId, isDoNotDisturb };
}

export class FakeHandle implements NotificationHandle {
  destroyed = false;
  compacted = false;
  downgraded = false;
  destroyCalls = 0;
  compactCalls = 0;
  downgradeCalls = 0;
  private readonly _bytes: number;
  private _compactBytes: number;

  get estimatedBytes(): number {
    if (this.downgraded) return 0;
    return this.compacted ? this._compactBytes : this._bytes;
  }

  constructor(
    readonly id: number,
    readonly sourceKey: SourceKey,
    readonly receivedAtMs: number,
    estimatedBytes = 0,
    readonly isCritical = false,
    readonly forFeedback = false,
    readonly isTransient = true,
    readonly destroyThrows = false,
    compactBytes = 36_864,
    readonly compactThrows = false,
    readonly sourceId = "app.test",
  ) {
    this._bytes = estimatedBytes;
    this._compactBytes = compactBytes;
  }

  setCompactBytes(bytes: number): void {
    this._compactBytes = bytes;
  }

  isCompacted(): boolean {
    return this.compacted;
  }

  compact(): void {
    this.compactCalls++;
    if (this.compactThrows) throw new Error("compact failed");
    this.compacted = true;
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

export function makeSettingsStore(
  settings: MutableRuleSettings,
): SettingsStore & { notify(): void } {
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };
  const store = {
    read: () => settings,
    onChanged: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setGuardEnabled: (value: boolean) => {
      settings.guardEnabled = value;
      notify();
    },
    setNotifyEnabled: (value: boolean) => {
      settings.notifyEnabled = value;
      notify();
    },
    setMaxCount: (value: number) => {
      settings.maxCount = value;
      notify();
    },
    dispose: () => {
      listeners.clear();
    },
    notify,
  };
  return store as unknown as SettingsStore & { notify(): void };
}

export function makeBridge(
  handles: Map<number, NotificationHandle>,
  byNotification: Map<unknown, number>,
): Bridge {
  return {
    capabilities: { tray: true, topBar: true, dateMenu: true },
    start: () => true,
    adoptExisting: () => {},
    sourceKeyFor: () => SourceKey.Screenshot,
    makeHandle: (notification) => {
      const id = byNotification.get(notification) ?? handles.size + 1;
      const handle = handles.get(id);
      if (handle) byNotification.set(notification, id);
      return handle ?? null;
    },
    idFor: (notification) => byNotification.get(notification) ?? null,
    currentlyShownId: () => null,
    isDoNotDisturb: () => true,
    readRssBytes: () => 0,
    stop: () => {},
  };
}
