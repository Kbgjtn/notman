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

  it("writes setters back to the backend", () => {
    const settings: Record<string, unknown> = {};
    const store = new SettingsStore(fakeBackend(settings) as never);

    store.setNotifyEnabled(false);
    store.setMaxCount(9);

    expect(settings["screenshot-notify-enabled"]).toBe(false);
    expect(settings["screenshot-max-count"]).toBe(9);
  });
});
