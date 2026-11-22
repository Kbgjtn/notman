import type Gio from "gi://Gio";

import { log } from "./log.js";
import { IndicatorPosition, type RuleSettings, ThumbnailMode } from "./types.js";

export enum SettingKey {
  GuardEnabled = "guard-enabled",
  ScreenshotNotifyEnabled = "screenshot-notify-enabled",
  ScreencastNotifyEnabled = "screencast-notify-enabled",
  ScreenshotThumbnailMode = "screenshot-thumbnail-mode",
  ScreenshotMaxCount = "screenshot-max-count",
  ScreenshotExpireSeconds = "screenshot-expire-seconds",
  ScreenshotMemoryBudgetMb = "screenshot-memory-budget-mb",
  EmergencyHardCap = "emergency-hard-cap",
  TransientExpireEnabled = "transient-expire-enabled",
  TransientExpireSeconds = "transient-expire-seconds",
  TransientDndOnly = "transient-dnd-only",
  GlobalExpireMinutes = "global-expire-minutes",
  GlobalMaxCount = "global-max-count",
  BurstLimitEnabled = "burst-limit-enabled",
  BurstWindowSeconds = "burst-window-seconds",
  BurstMaxPerSource = "burst-max-per-source",
  ShowIndicator = "show-indicator",
  IndicatorPosition = "indicator-position",
  IndicatorIndex = "indicator-index",
  ClearOnPanelOpen = "clear-on-panel-open",
  DebugLogging = "debug-logging",
}

const DEFAULTS: RuleSettings = {
  guardEnabled: true,
  notifyEnabled: true,
  screencastNotifyEnabled: true,
  thumbnailMode: ThumbnailMode.Full,
  maxCount: 3,
  expireSeconds: 15,
  memoryBudgetMb: 64,
  emergencyHardCap: 64,
  transientExpireEnabled: false,
  transientExpireSeconds: 30,
  transientDndOnly: true,
  globalExpireMinutes: 0,
  globalMaxCount: 0,
  burstLimitEnabled: false,
  burstWindowSeconds: 10,
  burstMaxPerSource: 3,
};

const RULE_KEYS = new Set<string>([
  SettingKey.GuardEnabled,
  SettingKey.ScreenshotNotifyEnabled,
  SettingKey.ScreencastNotifyEnabled,
  SettingKey.ScreenshotThumbnailMode,
  SettingKey.ScreenshotMaxCount,
  SettingKey.ScreenshotExpireSeconds,
  SettingKey.ScreenshotMemoryBudgetMb,
  SettingKey.EmergencyHardCap,
  SettingKey.TransientExpireEnabled,
  SettingKey.TransientExpireSeconds,
  SettingKey.TransientDndOnly,
  SettingKey.GlobalExpireMinutes,
  SettingKey.GlobalMaxCount,
  SettingKey.BurstLimitEnabled,
  SettingKey.BurstWindowSeconds,
  SettingKey.BurstMaxPerSource,
]);

export function parseThumbnailMode(raw: string): ThumbnailMode {
  if (raw === ThumbnailMode.Compact) return ThumbnailMode.Compact;
  if (raw === ThumbnailMode.TextOnly) return ThumbnailMode.TextOnly;
  return ThumbnailMode.Full;
}

export function parseIndicatorPosition(raw: string): IndicatorPosition {
  if (raw === IndicatorPosition.Left) return IndicatorPosition.Left;
  if (raw === IndicatorPosition.Center) return IndicatorPosition.Center;
  return IndicatorPosition.Right;
}

function clampMaxCount(value: number): number {
  if (!Number.isFinite(value)) return DEFAULTS.maxCount;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/** Reads settings defensively with caching and change notifications. */
export class SettingsStore {
  private readonly _warned = new Set<string>();
  private readonly _listeners = new Set<() => void>();
  private _cache: RuleSettings | null = null;
  private _changedId: number | null = null;

  constructor(private readonly _settings: Gio.Settings) {
    if (typeof _settings.connect === "function") {
      try {
        this._changedId = _settings.connect("changed", (_settings: unknown, key?: string) => {
          if (key && !RULE_KEYS.has(key)) return;
          this._cache = null;
          for (const listener of [...this._listeners]) {
            try {
              listener();
            } catch (e) {
              log.err("settings", "change listener failed", e);
            }
          }
        });
      } catch (e) {
        log.err("settings", "could not connect settings changed signal", e);
      }
    }
  }

  private getBoolean(key: SettingKey, fallback: boolean): boolean {
    try {
      return this._settings.get_boolean(key);
    } catch (e) {
      this.warn(key, e);
      return fallback;
    }
  }

  private getInt(key: SettingKey, fallback: number): number {
    try {
      return this._settings.get_int(key);
    } catch (e) {
      this.warn(key, e);
      return fallback;
    }
  }

  private warn(key: string, error: unknown): void {
    if (this._warned.has(key)) return;
    this._warned.add(key);
    log.err("settings", `unreadable setting '${key}', using default`, error);
  }

  read(): RuleSettings {
    if (this._cache) return this._cache;

    let rawMode: string = ThumbnailMode.Full;
    try {
      rawMode = this._settings.get_string(SettingKey.ScreenshotThumbnailMode);
    } catch (e) {
      this.warn(SettingKey.ScreenshotThumbnailMode, e);
    }
    const thumbnailMode = parseThumbnailMode(rawMode);
    const snapshot: RuleSettings = {
      guardEnabled: this.getBoolean(SettingKey.GuardEnabled, DEFAULTS.guardEnabled),
      notifyEnabled: this.getBoolean(SettingKey.ScreenshotNotifyEnabled, DEFAULTS.notifyEnabled),
      screencastNotifyEnabled: this.getBoolean(
        SettingKey.ScreencastNotifyEnabled,
        DEFAULTS.screencastNotifyEnabled,
      ),
      thumbnailMode,
      maxCount: this.getInt(SettingKey.ScreenshotMaxCount, DEFAULTS.maxCount),
      expireSeconds: this.getInt(SettingKey.ScreenshotExpireSeconds, DEFAULTS.expireSeconds),
      memoryBudgetMb: this.getInt(SettingKey.ScreenshotMemoryBudgetMb, DEFAULTS.memoryBudgetMb),
      emergencyHardCap: this.getInt(SettingKey.EmergencyHardCap, DEFAULTS.emergencyHardCap),
      transientExpireEnabled: this.getBoolean(
        SettingKey.TransientExpireEnabled,
        DEFAULTS.transientExpireEnabled,
      ),
      transientExpireSeconds: this.getInt(
        SettingKey.TransientExpireSeconds,
        DEFAULTS.transientExpireSeconds,
      ),
      transientDndOnly: this.getBoolean(SettingKey.TransientDndOnly, DEFAULTS.transientDndOnly),
      globalExpireMinutes: this.getInt(
        SettingKey.GlobalExpireMinutes,
        DEFAULTS.globalExpireMinutes,
      ),
      globalMaxCount: this.getInt(SettingKey.GlobalMaxCount, DEFAULTS.globalMaxCount),
      burstLimitEnabled: this.getBoolean(SettingKey.BurstLimitEnabled, DEFAULTS.burstLimitEnabled),
      burstWindowSeconds: this.getInt(SettingKey.BurstWindowSeconds, DEFAULTS.burstWindowSeconds),
      burstMaxPerSource: this.getInt(SettingKey.BurstMaxPerSource, DEFAULTS.burstMaxPerSource),
    };
    if (this._changedId !== null) this._cache = snapshot;
    return snapshot;
  }

  onChanged(listener: () => void): () => void {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }

  setGuardEnabled(enabled: boolean): void {
    try {
      this._cache = null;
      this._settings.set_boolean(SettingKey.GuardEnabled, enabled);
    } catch (e) {
      log.err("settings", `could not persist ${SettingKey.GuardEnabled}`, e);
    }
  }

  setNotifyEnabled(enabled: boolean): void {
    try {
      this._cache = null;
      this._settings.set_boolean(SettingKey.ScreenshotNotifyEnabled, enabled);
    } catch (e) {
      log.err("settings", `could not persist ${SettingKey.ScreenshotNotifyEnabled}`, e);
    }
  }

  setMaxCount(count: number): void {
    try {
      this._cache = null;
      this._settings.set_int(SettingKey.ScreenshotMaxCount, clampMaxCount(count));
    } catch (e) {
      log.err("settings", `could not persist ${SettingKey.ScreenshotMaxCount}`, e);
    }
  }

  dispose(): void {
    this._listeners.clear();
    this._cache = null;
    if (this._changedId !== null) {
      try {
        this._settings.disconnect(this._changedId);
      } catch {
        // Settings may already be gone.
      }
      this._changedId = null;
    }
  }
}
