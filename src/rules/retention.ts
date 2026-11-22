import {
  emptyOutcome,
  type NotificationHandle,
  type Rule,
  type RuleContext,
  type RuleOutcome,
} from "../types.js";

const MINUTE_MS = 60_000;

/** Global age-based expiry and total notification-list cap across all sources. */
export class RetentionRule implements Rule {
  readonly id = "retention";

  evaluate(handles: NotificationHandle[], context: RuleContext): RuleOutcome {
    const outcome = emptyOutcome();
    const { settings } = context;
    if (!settings.guardEnabled) return outcome;
    if (settings.globalExpireMinutes <= 0 && settings.globalMaxCount <= 0) return outcome;

    const oldestFirst = handles
      .filter((h) => !h.isCritical && !h.forFeedback && h.id !== context.currentlyShownId)
      .sort((a, b) => a.receivedAtMs - b.receivedAtMs);
    if (oldestFirst.length === 0) return outcome;

    const destroySet = new Set<NotificationHandle>();

    if (settings.globalExpireMinutes > 0) {
      const cutoff = context.nowMs - settings.globalExpireMinutes * MINUTE_MS;
      for (const handle of oldestFirst) {
        if (handle.receivedAtMs <= cutoff) destroySet.add(handle);
      }
    }

    if (settings.globalMaxCount > 0) {
      const surviving = oldestFirst.filter((h) => !destroySet.has(h));
      if (surviving.length > settings.globalMaxCount) {
        for (const handle of surviving.slice(0, surviving.length - settings.globalMaxCount)) {
          destroySet.add(handle);
        }
      }
    }

    outcome.destroy = [...destroySet];
    return outcome;
  }
}
