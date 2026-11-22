import {
  emptyOutcome,
  type NotificationHandle,
  type Rule,
  type RuleContext,
  type RuleOutcome,
  SourceKey,
} from "../types.js";

/** Last-resort bound, independent of the screenshot-specific rules. */
export class CapRule implements Rule {
  readonly id = "cap";

  evaluate(handles: NotificationHandle[], context: RuleContext): RuleOutcome {
    const outcome = emptyOutcome();
    const cap = context.settings.emergencyHardCap;
    if (!context.settings.guardEnabled || cap <= 0) return outcome;

    const managed = handles.filter((h) => h.sourceKey === SourceKey.Screenshot || h.isTransient);
    if (managed.length <= cap) return outcome;

    const eligible = managed
      .filter((h) => !h.isCritical && !h.forFeedback && h.id !== context.currentlyShownId)
      .sort((a, b) => a.receivedAtMs - b.receivedAtMs);
    const excess = Math.min(eligible.length, managed.length - cap);
    outcome.destroy.push(...eligible.slice(0, excess));
    return outcome;
  }
}
