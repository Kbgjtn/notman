import {
  emptyOutcome,
  type NotificationHandle,
  type Rule,
  type RuleContext,
  type RuleOutcome,
} from '../types.js';

/** Last-resort bound, independent of the screenshot-specific rules. */
export class CapRule implements Rule {
  readonly id = 'cap';

  evaluate(handles: NotificationHandle[], context: RuleContext): RuleOutcome {
    const outcome = emptyOutcome();
    const cap = context.settings.emergencyHardCap;
    if (!context.settings.guardEnabled || cap <= 0 || handles.length <= cap) return outcome;

    const eligible = handles
      .filter((h) => !h.isCritical && !h.forFeedback && h.id !== context.currentlyShownId)
      .sort((a, b) => a.receivedAtMs - b.receivedAtMs);
    const excess = Math.min(eligible.length, handles.length - cap);
    outcome.destroy.push(...eligible.slice(0, excess));
    return outcome;
  }
}
