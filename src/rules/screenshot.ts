import {
  emptyOutcome,
  type NotificationHandle,
  type Rule,
  type RuleContext,
  type RuleOutcome,
} from '../types.js';

/** Retention, expiry, thumbnail and memory rules for screenshot sources. */
export class ScreenshotRule implements Rule {
  readonly id = 'screenshot';

  evaluate(handles: NotificationHandle[], context: RuleContext): RuleOutcome {
    const outcome = emptyOutcome();
    const { settings } = context;
    if (!settings.guardEnabled) return outcome;

    const shots = handles.filter(
      (h) =>
        h.sourceKey === 'screenshot' &&
        !h.isCritical &&
        !h.forFeedback &&
        h.id !== context.currentlyShownId,
    );
    if (shots.length === 0) return outcome;

    if (!settings.notifyEnabled) {
      outcome.destroy.push(...shots);
      return outcome;
    }

    if (settings.thumbnailMode === 'text-only') {
      for (const handle of shots) {
        if (!handle.isDowngraded()) outcome.downgrade.push(handle);
      }
    }

    const oldestFirst = [...shots].sort((a, b) => a.receivedAtMs - b.receivedAtMs);

    if (settings.expireSeconds > 0) {
      const cutoff = context.nowMs - settings.expireSeconds * 1000;
      for (const handle of oldestFirst) {
        if (handle.receivedAtMs <= cutoff) outcome.destroy.push(handle);
      }
    }

    if (settings.maxCount > 0 && shots.length > settings.maxCount) {
      outcome.destroy.push(...oldestFirst.slice(0, shots.length - settings.maxCount));
    }

    if (settings.memoryBudgetMb > 0) {
      const limit = settings.memoryBudgetMb * 1024 * 1024;
      let total = shots.reduce((sum, h) => sum + h.estimatedBytes, 0);
      for (const handle of oldestFirst) {
        if (total <= limit) break;
        if (!outcome.destroy.includes(handle)) outcome.destroy.push(handle);
        total -= handle.estimatedBytes;
      }
    }

    outcome.destroy = [...new Set(outcome.destroy)];
    return outcome;
  }
}
