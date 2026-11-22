import { formatTimeMinutes, parseTimeMinutes } from "./quiet-hours.js";
import { parseAppRules, SettingKey } from "./settings.js";
import { IndicatorPosition, ThumbnailMode } from "./types.js";

export interface SettingsBackend {
  get_boolean(key: string): boolean;
  get_int(key: string): number;
  get_string(key: string): string;
  set_boolean(key: string, value: boolean): void;
  set_int(key: string, value: number): void;
  set_string(key: string, value: string): void;
}

const BOOLEAN_KEYS: readonly SettingKey[] = [
  SettingKey.GuardEnabled,
  SettingKey.ScreenshotNotifyEnabled,
  SettingKey.ScreencastNotifyEnabled,
  SettingKey.TransientExpireEnabled,
  SettingKey.TransientDndOnly,
  SettingKey.BurstLimitEnabled,
  SettingKey.QuietHoursEnabled,
  SettingKey.ShowIndicator,
  SettingKey.ClearOnPanelOpen,
  SettingKey.DebugLogging,
];

const INT_RANGES: ReadonlyArray<readonly [SettingKey, number, number]> = [
  [SettingKey.ScreenshotMaxCount, 0, 100],
  [SettingKey.ScreenshotExpireSeconds, 0, 300],
  [SettingKey.ScreenshotMemoryBudgetMb, 0, 512],
  [SettingKey.EmergencyHardCap, 0, 256],
  [SettingKey.TransientExpireSeconds, 5, 300],
  [SettingKey.GlobalExpireMinutes, 0, 1440],
  [SettingKey.GlobalMaxCount, 0, 100],
  [SettingKey.BurstWindowSeconds, 2, 60],
  [SettingKey.BurstMaxPerSource, 1, 20],
  [SettingKey.IndicatorIndex, 0, 20],
];

const STRING_KEYS: readonly SettingKey[] = [
  SettingKey.ScreenshotThumbnailMode,
  SettingKey.IndicatorPosition,
  SettingKey.AppRules,
  SettingKey.QuietHoursStart,
  SettingKey.QuietHoursEnd,
];

const VALID_THUMBNAIL_MODES = new Set<string>(Object.values(ThumbnailMode));
const VALID_INDICATOR_POSITIONS = new Set<string>(Object.values(IndicatorPosition));

export function exportSettingsJson(backend: SettingsBackend): string {
  const data: Record<string, boolean | number | string> = {};
  for (const key of BOOLEAN_KEYS) data[key] = backend.get_boolean(key);
  for (const [key] of INT_RANGES) data[key] = backend.get_int(key);
  for (const key of STRING_KEYS) data[key] = backend.get_string(key);
  return `${JSON.stringify({ version: 1, settings: data }, null, 2)}\n`;
}

export function importSettingsJson(raw: string, backend: SettingsBackend): number {
  const parsed = JSON.parse(raw) as { settings?: unknown };
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    !parsed.settings ||
    typeof parsed.settings !== "object" ||
    Array.isArray(parsed.settings)
  ) {
    throw new Error("Invalid Notman settings file");
  }
  const src = parsed.settings as Record<string, unknown>;
  let applied = 0;

  for (const key of BOOLEAN_KEYS) {
    if (typeof src[key] === "boolean") {
      backend.set_boolean(key, src[key]);
      applied++;
    }
  }

  for (const [key, min, max] of INT_RANGES) {
    if (typeof src[key] === "number" && Number.isFinite(src[key])) {
      const clamped = Math.min(max, Math.max(min, Math.round(src[key])));
      backend.set_int(key, clamped);
      applied++;
    }
  }

  const modeVal = src[SettingKey.ScreenshotThumbnailMode];
  if (typeof modeVal === "string" && VALID_THUMBNAIL_MODES.has(modeVal)) {
    backend.set_string(SettingKey.ScreenshotThumbnailMode, modeVal);
    applied++;
  }
  const posVal = src[SettingKey.IndicatorPosition];
  if (typeof posVal === "string" && VALID_INDICATOR_POSITIONS.has(posVal)) {
    backend.set_string(SettingKey.IndicatorPosition, posVal);
    applied++;
  }
  const rulesRaw = src[SettingKey.AppRules];
  if (typeof rulesRaw === "string") {
    try {
      const parsedRules = JSON.parse(rulesRaw);
      if (Array.isArray(parsedRules)) {
        backend.set_string(SettingKey.AppRules, JSON.stringify(parseAppRules(rulesRaw)));
        applied++;
      }
    } catch {
      // Ignore malformed app-rules JSON instead of clobbering existing rules.
    }
  }
  for (const timeKey of [SettingKey.QuietHoursStart, SettingKey.QuietHoursEnd]) {
    const val = src[timeKey];
    if (typeof val === "string") {
      const minutes = parseTimeMinutes(val);
      if (minutes !== null) {
        backend.set_string(timeKey, formatTimeMinutes(Math.floor(minutes / 60), minutes % 60));
        applied++;
      }
    }
  }

  return applied;
}
