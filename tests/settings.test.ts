import { describe, expect, it, vi } from "vitest";

import { parseThumbnailMode, SettingKey, SettingsStore } from "../src/settings.js";
import { type RuleSettings, ThumbnailMode } from "../src/types.js";

function fakeBackend(settings: Record<string, unknown>) {
  let changedCb: ((_s: unknown, key?: string) => void) | null = null;
  let disconnected = false;
  return {
    get_boolean: vi.fn((key: string) => Boolean(settings[key])),
    get_string: vi.fn((key: string) => String(settings[key] ?? "")),
    get_int: vi.fn((key: string) => Number(settings[key] ?? 0)),
    set_boolean: vi.fn((key: string, value: boolean) => {
      settings[key] = value;
      changedCb?.(null, key);
    }),
    set_int: vi.fn((key: string, value: number) => {
      settings[key] = value;
      changedCb?.(null, key);
    }),
    connect: vi.fn((_signal: string, cb: (_s: unknown, key?: string) => void) => {
      changedCb = cb;
      return 42;
    }),
    disconnect: vi.fn(() => {
      disconnected = true;
      changedCb = null;
    }),
    emitChanged: (key: string) => changedCb?.(null, key),
    isDisconnected: () => disconnected,
  };
}

describe("SettingsStore", () => {
  it("maps all schema keys into rule settings", () => {
    const settings = fakeBackend({
      [SettingKey.GuardEnabled]: true,
      [SettingKey.ScreenshotNotifyEnabled]: false,
      [SettingKey.ScreenshotThumbnailMode]: ThumbnailMode.TextOnly,
      [SettingKey.ScreenshotMaxCount]: 5,
      [SettingKey.ScreenshotExpireSeconds]: 30,
      [SettingKey.ScreenshotMemoryBudgetMb]: 128,
      [SettingKey.EmergencyHardCap]: 20,
      [SettingKey.TransientExpireEnabled]: true,
      [SettingKey.TransientExpireSeconds]: 45,
      [SettingKey.TransientDndOnly]: false,
    });
    const store = new SettingsStore(settings as never);

    const expected: RuleSettings = {
      guardEnabled: true,
      notifyEnabled: false,
      thumbnailMode: ThumbnailMode.TextOnly,
      maxCount: 5,
      expireSeconds: 30,
      memoryBudgetMb: 128,
      emergencyHardCap: 20,
      transientExpireEnabled: true,
      transientExpireSeconds: 45,
      transientDndOnly: false,
    };
    expect(store.read()).toEqual(expected);
  });

  it("caches reads until a rule key changes and notifies listeners", () => {
    const raw: Record<string, unknown> = {
      [SettingKey.GuardEnabled]: true,
      [SettingKey.ScreenshotNotifyEnabled]: true,
      [SettingKey.ScreenshotThumbnailMode]: ThumbnailMode.Full,
      [SettingKey.ScreenshotMaxCount]: 3,
      [SettingKey.ScreenshotExpireSeconds]: 15,
      [SettingKey.ScreenshotMemoryBudgetMb]: 64,
      [SettingKey.EmergencyHardCap]: 64,
    };
    const backend = fakeBackend(raw);
    const store = new SettingsStore(backend as never);
    const listener = vi.fn();
    const unsub = store.onChanged(listener);

    const first = store.read();
    const second = store.read();
    expect(second).toBe(first);
    expect(backend.get_int).toHaveBeenCalledTimes(5);

    // Non-rule keys should not invalidate cache or fire rule listeners.
    backend.emitChanged(SettingKey.ShowIndicator);
    expect(listener).not.toHaveBeenCalled();
    expect(store.read()).toBe(first);

    raw[SettingKey.ScreenshotMaxCount] = 10;
    backend.emitChanged(SettingKey.ScreenshotMaxCount);
    expect(listener).toHaveBeenCalledOnce();
    expect(store.read().maxCount).toBe(10);

    unsub();
    store.dispose();
    expect(backend.isDisconnected()).toBe(true);
  });

  it("falls back to full thumbnails for an unknown mode", () => {
    const store = new SettingsStore(
      fakeBackend({
        [SettingKey.ScreenshotThumbnailMode]: "unexpected",
      }) as never,
    );
    expect(store.read().thumbnailMode).toBe(ThumbnailMode.Full);
  });

  it("falls back to defaults and does not throw when a key is missing", () => {
    const broken = {
      get_boolean: () => {
        throw new Error("missing key");
      },
      get_string: () => {
        throw new Error("missing key");
      },
      get_int: () => {
        throw new Error("missing key");
      },
      set_boolean: () => {
        throw new Error("missing key");
      },
      set_int: () => {
        throw new Error("missing key");
      },
    };
    const store = new SettingsStore(broken as never);

    expect(store.read()).toEqual({
      guardEnabled: true,
      notifyEnabled: true,
      thumbnailMode: ThumbnailMode.Full,
      maxCount: 3,
      expireSeconds: 15,
      memoryBudgetMb: 64,
      emergencyHardCap: 64,
      transientExpireEnabled: false,
      transientExpireSeconds: 30,
      transientDndOnly: true,
    });
    expect(() => store.setGuardEnabled(false)).not.toThrow();
    expect(() => store.setNotifyEnabled(false)).not.toThrow();
    expect(() => store.setMaxCount(1)).not.toThrow();
  });

  it("writes setters back to the backend and clamps maxCount", () => {
    const settings: Record<string, unknown> = {};
    const store = new SettingsStore(fakeBackend(settings) as never);

    store.setGuardEnabled(false);
    store.setNotifyEnabled(false);
    store.setMaxCount(9);
    expect(settings[SettingKey.GuardEnabled]).toBe(false);
    expect(settings[SettingKey.ScreenshotNotifyEnabled]).toBe(false);
    expect(settings[SettingKey.ScreenshotMaxCount]).toBe(9);

    store.setMaxCount(999);
    expect(settings[SettingKey.ScreenshotMaxCount]).toBe(100);
    store.setMaxCount(-5);
    expect(settings[SettingKey.ScreenshotMaxCount]).toBe(0);
    store.setMaxCount(NaN);
    expect(settings[SettingKey.ScreenshotMaxCount]).toBe(3);
  });

  it("reads compact thumbnail mode from schema", () => {
    const store = new SettingsStore(
      fakeBackend({
        [SettingKey.ScreenshotThumbnailMode]: ThumbnailMode.Compact,
      }) as never,
    );
    expect(store.read().thumbnailMode).toBe(ThumbnailMode.Compact);
  });

  it("parses thumbnail modes cleanly with fallback to full", () => {
    expect(parseThumbnailMode(ThumbnailMode.Full)).toBe(ThumbnailMode.Full);
    expect(parseThumbnailMode(ThumbnailMode.Compact)).toBe(ThumbnailMode.Compact);
    expect(parseThumbnailMode(ThumbnailMode.TextOnly)).toBe(ThumbnailMode.TextOnly);
    expect(parseThumbnailMode("unexpected")).toBe(ThumbnailMode.Full);
  });
});
