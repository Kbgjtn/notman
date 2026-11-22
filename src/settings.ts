import type Gio from 'gi://Gio';

import type { RuleSettings, ThumbnailMode } from './types.js';

export class SettingsStore {
  private readonly _settings: Gio.Settings;

  constructor(settings: Gio.Settings) {
    this._settings = settings;
  }

  read(): RuleSettings {
    const mode: string = this._settings.get_string('screenshot-thumbnail-mode');
    const thumbnailMode: ThumbnailMode = mode === 'text-only' ? 'text-only' : 'full';
    return {
      guardEnabled: this._settings.get_boolean('guard-enabled'),
      notifyEnabled: this._settings.get_boolean('screenshot-notify-enabled'),
      thumbnailMode,
      maxCount: this._settings.get_int('screenshot-max-count'),
      expireSeconds: this._settings.get_int('screenshot-expire-seconds'),
      memoryBudgetMb: this._settings.get_int('screenshot-memory-budget-mb'),
      emergencyHardCap: this._settings.get_int('emergency-hard-cap'),
    };
  }

  setNotifyEnabled(enabled: boolean): void {
    this._settings.set_boolean('screenshot-notify-enabled', enabled);
  }

  setMaxCount(count: number): void {
    this._settings.set_int('screenshot-max-count', count);
  }
}
