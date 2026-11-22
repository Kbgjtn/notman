export enum ThumbnailMode {
  Full = "full",
  Compact = "compact",
  TextOnly = "text-only",
}

export enum IndicatorPosition {
  Left = "left",
  Center = "center",
  Right = "right",
}

export enum SourceKey {
  Screenshot = "screenshot",
  Screencast = "screencast",
  Other = "other",
}

export enum CapabilityTier {
  Headless = 1,
  TopBar = 2,
}

export interface SignalEmitter {
  connect(signal: string, callback: (...args: unknown[]) => void): number;
  disconnect(id: number): void;
}

export interface RuleSettings {
  readonly guardEnabled: boolean;
  readonly notifyEnabled: boolean;
  readonly screencastNotifyEnabled: boolean;
  readonly thumbnailMode: ThumbnailMode;
  readonly maxCount: number;
  readonly expireSeconds: number;
  readonly memoryBudgetMb: number;
  readonly emergencyHardCap: number;
  readonly transientExpireEnabled: boolean;
  readonly transientExpireSeconds: number;
  readonly transientDndOnly: boolean;
  readonly globalExpireMinutes: number;
  readonly globalMaxCount: number;
}

export interface NotificationHandle {
  readonly id: number;
  readonly sourceKey: SourceKey;
  readonly receivedAtMs: number;
  readonly estimatedBytes: number;
  readonly isCritical: boolean;
  readonly forFeedback: boolean;
  readonly isTransient: boolean;
  isCompacted(): boolean;
  compact(): void;
  isDowngraded(): boolean;
  downgrade(): void;
  destroy(): boolean;
}

export interface RuleContext {
  readonly nowMs: number;
  readonly settings: RuleSettings;
  readonly currentlyShownId: number | null;
  readonly isDoNotDisturb: boolean;
}

export interface RuleOutcome {
  destroy: NotificationHandle[];
  compact: NotificationHandle[];
  downgrade: NotificationHandle[];
}

export interface Rule {
  readonly id: string;
  evaluate(handles: NotificationHandle[], context: RuleContext): RuleOutcome;
}

export const emptyOutcome = (): RuleOutcome => ({ destroy: [], compact: [], downgrade: [] });
