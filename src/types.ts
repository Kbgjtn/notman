export type ThumbnailMode = "full" | "text-only";

export interface RuleSettings {
  guardEnabled: boolean;
  notifyEnabled: boolean;
  thumbnailMode: ThumbnailMode;
  maxCount: number;
  expireSeconds: number;
  memoryBudgetMb: number;
  emergencyHardCap: number;
}

export interface NotificationHandle {
  readonly id: number;
  readonly sourceKey: string;
  readonly receivedAtMs: number;
  readonly estimatedBytes: number;
  readonly isCritical: boolean;
  readonly forFeedback: boolean;
  readonly isTransient: boolean;
  isDowngraded(): boolean;
  downgrade(): void;
  destroy(): boolean;
}

export interface RuleContext {
  nowMs: number;
  settings: RuleSettings;
  currentlyShownId: number | null;
  log(message: string): void;
}

export interface RuleOutcome {
  destroy: NotificationHandle[];
  downgrade: NotificationHandle[];
}

export interface Rule {
  readonly id: string;
  evaluate(handles: NotificationHandle[], context: RuleContext): RuleOutcome;
}

export const emptyOutcome = (): RuleOutcome => ({ destroy: [], downgrade: [] });
