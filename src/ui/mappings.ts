export const MiB = 1024 * 1024;

export function modeToSwitch(mode: string): boolean {
  return mode === "text-only";
}

export function switchToMode(enabled: boolean): string {
  return enabled ? "text-only" : "full";
}

export function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}
