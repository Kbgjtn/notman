import {
  emptyOutcome,
  type NotificationHandle,
  type Rule,
  type RuleContext,
  type RuleOutcome,
  SourceKey,
} from "../types.js";

/** Discards shell-internal screencast notifications when disabled. */
export class ScreencastRule implements Rule {
  readonly id = "screencast";

  evaluate(handles: NotificationHandle[], context: RuleContext): RuleOutcome {
    const outcome = emptyOutcome();
    const { settings } = context;
    if (!settings.guardEnabled || settings.screencastNotifyEnabled) return outcome;

    for (const handle of handles) {
      if (
        handle.sourceKey === SourceKey.Screencast &&
        !handle.isCritical &&
        !handle.forFeedback &&
        handle.id !== context.currentlyShownId
      ) {
        outcome.destroy.push(handle);
      }
    }
    return outcome;
  }
}
