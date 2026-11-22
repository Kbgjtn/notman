import type { StatsSnapshot } from "../stats.js";

export const MAX_COUNT_STEPS = [0, 1, 2, 3, 5, 10, 20] as const;
export const EXPIRE_STEPS = [0, 2, 5, 10, 15, 30, 60, 300] as const;
export const BUDGET_STEPS = [0, 16, 32, 64, 128, 256] as const;
export const HARD_CAP_STEPS = [0, 4, 8, 16, 32, 64] as const;

export function modeToSwitch(mode: string): boolean {
  return mode === "text-only";
}

export function switchToMode(enabled: boolean): string {
  return enabled ? "text-only" : "full";
}

/** Cycles to the next allowed value; unknown values start from the first. */
export function cycleValue(current: number, steps: readonly number[]): number {
  if (steps.length === 0) return current;
  const index = steps.indexOf(current);
  return steps[(index + 1) % steps.length];
}

export function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export const MiB = 1024 * 1024;

export function formatStats(stats: StatsSnapshot): string {
  const bytes = (stats.estimatedBytes / MiB).toFixed(1);
  const peak = (stats.peakBytes / MiB).toFixed(1);
  const rss = (stats.shellRssBytes / MiB).toFixed(0);
  return `${stats.activeCount} kept · ${bytes} MiB · peak ${peak} MiB · shell ${rss} MiB · pruned ${stats.prunedCount}`;
}
