import type Gio from "gi://Gio";

import { logErr } from "./log.js";
import type { RuleSettings, ThumbnailMode } from "./types.js";

const DEFAULTS: RuleSettings = {
  guardEnabled: true,
  notifyEnabled: true,
  thumbnailMode: "full",
  maxCount: 3,
  expireSeconds: 15,
  memoryBudgetMb: 64,
  emergencyHardCap: 64,
};

/** Reads settings defensively: a broken schema must never crash the shell. */
export class SettingsStore {
  private readonly _warned = new Set<string>();

  constructor(private readonly _settings: Gio.Settings) {}

  private getBoolean(key: string, fallback: boolean): boolean {
    try {
      return this._settings.get_boolean(String(key));
    } catch (e) {
      this.warn(String(key), e);
      return fallback;
    }
  }

  private getInt(key: string, fallback: number): number {
    try {
      return this._settings.get_int(String(key));
    } catch (e) {
      this.warn(String(key), e);
      return fallback;
    }
  }

  private warn(key: string, error: unknown): void {
    if (this._warned.has(key)) return;
    this._warned.add(key);
    logErr(error, `notman: unreadable setting '${key}', using default`);
  }

  read(): RuleSettings {
    let mode = "full";
    try {
      mode = this._settings.get_string("screenshot-thumbnail-mode");
    } catch (e) {
      this.warn("screenshot-thumbnail-mode", e);
    }
    const thumbnailMode: ThumbnailMode = mode === "text-only" ? "text-only" : "full";
    return {
      guardEnabled: this.getBoolean("guard-enabled", DEFAULTS.guardEnabled),
      notifyEnabled: this.getBoolean("screenshot-notify-enabled", DEFAULTS.notifyEnabled),
      thumbnailMode,
      maxCount: this.getInt("screenshot-max-count", DEFAULTS.maxCount),
      expireSeconds: this.getInt("screenshot-expire-seconds", DEFAULTS.expireSeconds),
      memoryBudgetMb: this.getInt("screenshot-memory-budget-mb", DEFAULTS.memoryBudgetMb),
      emergencyHardCap: this.getInt("emergency-hard-cap", DEFAULTS.emergencyHardCap),
    };
  }

  setNotifyEnabled(enabled: boolean): void {
    try {
      this._settings.set_boolean("screenshot-notify-enabled", enabled);
    } catch (e) {
      logErr(e, "notman: could not persist screenshot-notify-enabled");
    }
  }

  setMaxCount(count: number): void {
    try {
      this._settings.set_int("screenshot-max-count", count);
    } catch (e) {
      logErr(e, "notman: could not persist screenshot-max-count");
    }
  }
}
