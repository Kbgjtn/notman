import { MiB } from "../byte-estimate.js";
import {
  emptyOutcome,
  type NotificationHandle,
  type Rule,
  type RuleContext,
  type RuleOutcome,
  SourceKey,
  ThumbnailMode,
} from "../types.js";

/** Retention, expiry, thumbnail and memory rules for screenshot sources. */
export class ScreenshotRule implements Rule {
  readonly id = "screenshot";

  evaluate(handles: NotificationHandle[], context: RuleContext): RuleOutcome {
    const outcome = emptyOutcome();
    const { settings } = context;
    if (!settings.guardEnabled) return outcome;

    const shots = handles.filter(
      (h) =>
        h.sourceKey === SourceKey.Screenshot &&
        !h.isCritical &&
        !h.forFeedback &&
        h.id !== context.currentlyShownId,
    );
    if (shots.length === 0) return outcome;

    if (!settings.notifyEnabled) {
      outcome.destroy.push(...shots);
      return outcome;
    }

    const oldestFirst = [...shots].sort((a, b) => a.receivedAtMs - b.receivedAtMs);
    const destroySet = new Set<NotificationHandle>();

    if (settings.expireSeconds > 0) {
      const cutoff = context.nowMs - settings.expireSeconds * 1000;
      for (const handle of oldestFirst) {
        if (handle.receivedAtMs <= cutoff) destroySet.add(handle);
      }
    }

    if (settings.maxCount > 0 && oldestFirst.length > settings.maxCount) {
      for (const handle of oldestFirst.slice(0, oldestFirst.length - settings.maxCount)) {
        destroySet.add(handle);
      }
    }

    const willDowngradeAll = settings.thumbnailMode === ThumbnailMode.TextOnly;
    const willCompactNew = settings.thumbnailMode === ThumbnailMode.Compact;
    if (settings.memoryBudgetMb > 0 && !willDowngradeAll) {
      const limit = settings.memoryBudgetMb * MiB;
      const surviving = oldestFirst.filter((h) => !destroySet.has(h));
      const effectiveBytes = (h: NotificationHandle): number =>
        willCompactNew && !h.isCompacted() && !h.isDowngraded() ? 0 : h.estimatedBytes;
      let total = surviving.reduce((sum, h) => sum + effectiveBytes(h), 0);
      for (const handle of surviving) {
        if (total <= limit) break;
        destroySet.add(handle);
        total -= effectiveBytes(handle);
      }
    }

    if (willCompactNew) {
      for (const handle of oldestFirst) {
        if (!destroySet.has(handle) && !handle.isCompacted() && !handle.isDowngraded()) {
          outcome.compact.push(handle);
        }
      }
    }

    if (willDowngradeAll) {
      for (const handle of oldestFirst) {
        if (!destroySet.has(handle) && !handle.isDowngraded()) outcome.downgrade.push(handle);
      }
    }

    outcome.destroy = [...destroySet];
    return outcome;
  }
}
