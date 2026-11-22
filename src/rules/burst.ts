import {
  emptyOutcome,
  type NotificationHandle,
  type Rule,
  type RuleContext,
  type RuleOutcome,
  SourceKey,
} from "../types.js";

/** Collapses rapid notification bursts per application within a sliding time window. */
export class BurstRule implements Rule {
  readonly id = "burst";

  evaluate(handles: NotificationHandle[], context: RuleContext): RuleOutcome {
    const outcome = emptyOutcome();
    const { settings } = context;
    if (!settings.guardEnabled || !settings.burstLimitEnabled) return outcome;
    if (settings.burstWindowSeconds <= 0 || settings.burstMaxPerSource <= 0) return outcome;

    const cutoff = context.nowMs - settings.burstWindowSeconds * 1000;
    const bySource = new Map<string, NotificationHandle[]>();

    for (const handle of handles) {
      if (
        handle.sourceKey === SourceKey.Screenshot ||
        handle.isCritical ||
        handle.forFeedback ||
        handle.id === context.currentlyShownId ||
        handle.receivedAtMs < cutoff
      ) {
        continue;
      }
      const key = handle.sourceId || "unknown";
      let group = bySource.get(key);
      if (!group) {
        group = [];
        bySource.set(key, group);
      }
      group.push(handle);
    }

    for (const group of bySource.values()) {
      if (group.length <= settings.burstMaxPerSource) continue;
      group.sort((a, b) => a.receivedAtMs - b.receivedAtMs);
      outcome.destroy.push(...group.slice(0, group.length - settings.burstMaxPerSource));
    }

    return outcome;
  }
}
