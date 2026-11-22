import {
  emptyOutcome,
  type NotificationHandle,
  type Rule,
  type RuleContext,
  type RuleOutcome,
  SourceKey,
} from "../types.js";

/** Expires non-screenshot transient notifications leaked under Do Not Disturb. */
export class TransientRule implements Rule {
  readonly id = "transient";

  evaluate(handles: NotificationHandle[], context: RuleContext): RuleOutcome {
    const outcome = emptyOutcome();
    const { settings } = context;
    if (!settings.guardEnabled || !settings.transientExpireEnabled) return outcome;
    if (settings.transientExpireSeconds <= 0) return outcome;
    if (settings.transientDndOnly && !context.isDoNotDisturb) return outcome;

    const cutoff = context.nowMs - settings.transientExpireSeconds * 1000;
    for (const handle of handles) {
      if (
        handle.sourceKey === SourceKey.Screenshot ||
        !handle.isTransient ||
        handle.isCritical ||
        handle.forFeedback ||
        handle.id === context.currentlyShownId
      ) {
        continue;
      }
      if (handle.receivedAtMs <= cutoff) outcome.destroy.push(handle);
    }
    return outcome;
  }
}
