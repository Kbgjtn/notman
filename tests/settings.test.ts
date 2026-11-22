import { describe, expect, it } from "vitest";

import { SettingsStore } from "../src/settings.js";
import type { RuleSettings } from "../src/types.js";

function fakeBackend(settings: Record<string, unknown>) {
  return {
    get_boolean: (key: string) => Boolean(settings[key]),
    get_string: (key: string) => String(settings[key] ?? ""),
    get_int: (key: string) => Number(settings[key] ?? 0),
    set_boolean: (key: string, value: boolean) => {
      settings[key] = value;
    },
    set_int: (key: string, value: number) => {
      settings[key] = value;
    },
  };
}

describe("SettingsStore", () => {
  it("maps all schema keys into rule settings", () => {
    const settings = fakeBackend({
      "guard-enabled": true,
      "screenshot-notify-enabled": false,
      "screenshot-thumbnail-mode": "text-only",
      "screenshot-max-count": 5,
      "screenshot-expire-seconds": 30,
      "screenshot-memory-budget-mb": 128,
      "emergency-hard-cap": 20,
    });
    const store = new SettingsStore(settings as never);

    const expected: RuleSettings = {
      guardEnabled: true,
      notifyEnabled: false,
      thumbnailMode: "text-only",
      maxCount: 5,
      expireSeconds: 30,
      memoryBudgetMb: 128,
      emergencyHardCap: 20,
    };
    expect(store.read()).toEqual(expected);
  });

  it("falls back to full thumbnails for an unknown mode", () => {
    const store = new SettingsStore(
      fakeBackend({
        "screenshot-thumbnail-mode": "unexpected",
      }) as never,
    );
    expect(store.read().thumbnailMode).toBe("full");
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
      thumbnailMode: "full",
      maxCount: 3,
      expireSeconds: 15,
      memoryBudgetMb: 64,
      emergencyHardCap: 64,
    });
    expect(() => store.setNotifyEnabled(false)).not.toThrow();
    expect(() => store.setMaxCount(1)).not.toThrow();
  });

  it("writes setters back to the backend", () => {
    const settings: Record<string, unknown> = {};
    const store = new SettingsStore(fakeBackend(settings) as never);

    store.setNotifyEnabled(false);
    store.setMaxCount(9);

    expect(settings["screenshot-notify-enabled"]).toBe(false);
    expect(settings["screenshot-max-count"]).toBe(9);
  });
});
