import {
  type AppRuleEntry,
  emptyOutcome,
  type NotificationHandle,
  type Rule,
  type RuleContext,
  type RuleOutcome,
  SourceKey,
} from "../types.js";

function findMatchingRule(
  sourceId: string,
  rules: readonly AppRuleEntry[],
): { index: number; rule: AppRuleEntry } | null {
  const needle = sourceId.toLowerCase();
  if (!needle) return null;
  for (let i = 0; i < rules.length; i++) {
    const pattern = rules[i].match.toLowerCase();
    if (pattern && needle.includes(pattern)) return { index: i, rule: rules[i] };
  }
  return null;
}

/** Per-application notification overrides (mute, max count, and age expiry). */
export class AppRule implements Rule {
  readonly id = "app";

  evaluate(handles: NotificationHandle[], context: RuleContext): RuleOutcome {
    const outcome = emptyOutcome();
    const { settings } = context;
    if (!settings.guardEnabled || settings.appRules.length === 0) return outcome;

    const destroySet = new Set<NotificationHandle>();
    const grouped = new Map<number, NotificationHandle[]>();

    for (const handle of handles) {
      if (
        handle.sourceKey === SourceKey.Screenshot ||
        handle.isCritical ||
        handle.forFeedback ||
        handle.id === context.currentlyShownId
      ) {
        continue;
      }
      const matched = findMatchingRule(handle.sourceId, settings.appRules);
      if (!matched) continue;

      if (matched.rule.muted) {
        destroySet.add(handle);
        continue;
      }
      let bucket = grouped.get(matched.index);
      if (!bucket) {
        bucket = [];
        grouped.set(matched.index, bucket);
      }
      bucket.push(handle);
    }

    for (const [ruleIndex, bucket] of grouped.entries()) {
      const rule = settings.appRules[ruleIndex];
      const oldestFirst = [...bucket].sort((a, b) => a.receivedAtMs - b.receivedAtMs);

      if (rule.expireSeconds > 0) {
        const cutoff = context.nowMs - rule.expireSeconds * 1000;
        for (const handle of oldestFirst) {
          if (handle.receivedAtMs <= cutoff) destroySet.add(handle);
        }
      }

      if (rule.maxCount > 0) {
        const surviving = oldestFirst.filter((h) => !destroySet.has(h));
        if (surviving.length > rule.maxCount) {
          for (const handle of surviving.slice(0, surviving.length - rule.maxCount)) {
            destroySet.add(handle);
          }
        }
      }
    }

    outcome.destroy = [...destroySet];
    return outcome;
  }
}
