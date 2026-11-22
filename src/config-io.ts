import {
  parseAppRules,
  parseIndicatorPosition,
  parseThumbnailMode,
  SettingKey,
} from "./settings.js";

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

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

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
    !parsed.settings ||
    typeof parsed.settings !== "object"
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

  if (typeof src[SettingKey.ScreenshotThumbnailMode] === "string") {
    backend.set_string(
      SettingKey.ScreenshotThumbnailMode,
      parseThumbnailMode(src[SettingKey.ScreenshotThumbnailMode]),
    );
    applied++;
  }
  if (typeof src[SettingKey.IndicatorPosition] === "string") {
    backend.set_string(
      SettingKey.IndicatorPosition,
      parseIndicatorPosition(src[SettingKey.IndicatorPosition]),
    );
    applied++;
  }
  if (typeof src[SettingKey.AppRules] === "string") {
    backend.set_string(
      SettingKey.AppRules,
      JSON.stringify(parseAppRules(src[SettingKey.AppRules])),
    );
    applied++;
  }
  for (const timeKey of [SettingKey.QuietHoursStart, SettingKey.QuietHoursEnd]) {
    const val = src[timeKey];
    if (typeof val === "string" && TIME_PATTERN.test(val.trim())) {
      backend.set_string(timeKey, val.trim());
      applied++;
    }
  }

  return applied;
}
