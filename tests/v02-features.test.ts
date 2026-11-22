import { describe, expect, it } from "vitest";

import { exportSettingsJson, importSettingsJson, type SettingsBackend } from "../src/config-io.js";
import {
  formatTimeMinutes,
  isWithinQuietHours,
  parseTimeMinutes,
  QuietHoursController,
} from "../src/quiet-hours.js";
import { AppRule } from "../src/rules/app.js";
import { SettingKey } from "../src/settings.js";
import { IndicatorPosition, SourceKey, ThumbnailMode } from "../src/types.js";
import { FakeHandle, FakeScheduler, makeContext, makeSettings } from "./fakes.js";

describe("AppRule", () => {
  const rule = new AppRule();
  const makeApp = (id: number, sourceId: string, receivedAtMs: number, isCritical = false) =>
    new FakeHandle(
      id,
      SourceKey.Other,
      receivedAtMs,
      0,
      isCritical,
      false,
      false,
      false,
      0,
      false,
      sourceId,
    );

  it("mutes matching apps case-insensitively while protecting critical/shown/screenshots", () => {
    const slack = makeApp(1, "com.slack.Slack.desktop", 1000);
    const slackCrit = makeApp(2, "com.slack.Slack.desktop", 2000, true);
    const slackShown = makeApp(3, "com.slack.Slack.desktop", 3000);
    const firefox = makeApp(4, "firefox.desktop", 4000);
    const shot = new FakeHandle(
      5,
      SourceKey.Screenshot,
      5000,
      0,
      false,
      false,
      true,
      false,
      0,
      false,
      "slack",
    );

    const outcome = rule.evaluate(
      [slack, slackCrit, slackShown, firefox, shot],
      makeContext(
        makeSettings({
          appRules: [{ match: "slack", muted: true, maxCount: 0, expireSeconds: 0 }],
        }),
        10_000,
        3,
      ),
    );
    expect(outcome.destroy).toEqual([slack]);
  });

  it("applies per-app maxCount and expireSeconds independently", () => {
    const old = makeApp(1, "discord", 10_000);
    const fresh1 = makeApp(2, "discord", 95_000);
    const fresh2 = makeApp(3, "discord", 98_000);
    const outcome = rule.evaluate(
      [old, fresh1, fresh2],
      makeContext(
        makeSettings({
          appRules: [{ match: "discord", muted: false, maxCount: 1, expireSeconds: 30 }],
        }),
        100_000,
      ),
    );
    expect(outcome.destroy.map((h) => h.id)).toEqual([1, 2]);
  });
});

describe("config-io", () => {
  function memoryBackend(initial: Record<string, boolean | number | string> = {}): {
    store: Record<string, boolean | number | string>;
    backend: SettingsBackend;
  } {
    const store: Record<string, boolean | number | string> = {
      [SettingKey.GuardEnabled]: true,
      [SettingKey.ScreenshotNotifyEnabled]: true,
      [SettingKey.ScreencastNotifyEnabled]: true,
      [SettingKey.ScreenshotThumbnailMode]: ThumbnailMode.Compact,
      [SettingKey.ScreenshotMaxCount]: 3,
      [SettingKey.ScreenshotExpireSeconds]: 15,
      [SettingKey.ScreenshotMemoryBudgetMb]: 64,
      [SettingKey.EmergencyHardCap]: 64,
      [SettingKey.TransientExpireEnabled]: false,
      [SettingKey.TransientExpireSeconds]: 30,
      [SettingKey.TransientDndOnly]: true,
      [SettingKey.GlobalExpireMinutes]: 0,
      [SettingKey.GlobalMaxCount]: 0,
      [SettingKey.BurstLimitEnabled]: false,
      [SettingKey.BurstWindowSeconds]: 10,
      [SettingKey.BurstMaxPerSource]: 3,
      [SettingKey.AppRules]: "[]",
      [SettingKey.QuietHoursEnabled]: false,
      [SettingKey.QuietHoursStart]: "22:00",
      [SettingKey.QuietHoursEnd]: "08:00",
      [SettingKey.ShowIndicator]: true,
      [SettingKey.IndicatorPosition]: IndicatorPosition.Right,
      [SettingKey.IndicatorIndex]: 0,
      [SettingKey.ClearOnPanelOpen]: false,
      [SettingKey.DebugLogging]: false,
      ...initial,
    };
    const backend: SettingsBackend = {
      get_boolean: (k) => Boolean(store[k]),
      get_int: (k) => Number(store[k] ?? 0),
      get_string: (k) => String(store[k] ?? ""),
      set_boolean: (k, v) => {
        store[k] = v;
      },
      set_int: (k, v) => {
        store[k] = v;
      },
      set_string: (k, v) => {
        store[k] = v;
      },
    };
    return { store, backend };
  }

  it("round-trips settings via JSON and clamps out-of-range values", () => {
    const src = memoryBackend({
      [SettingKey.ScreenshotThumbnailMode]: ThumbnailMode.Compact,
      [SettingKey.BurstLimitEnabled]: true,
      [SettingKey.QuietHoursStart]: "23:15",
    });
    const json = exportSettingsJson(src.backend);

    const dst = memoryBackend({
      [SettingKey.ScreenshotThumbnailMode]: ThumbnailMode.Full,
      [SettingKey.BurstLimitEnabled]: false,
      [SettingKey.QuietHoursStart]: "22:00",
    });
    const count = importSettingsJson(json, dst.backend);
    expect(count).toBeGreaterThan(20);
    expect(dst.store[SettingKey.ScreenshotThumbnailMode]).toBe(ThumbnailMode.Compact);
    expect(dst.store[SettingKey.BurstLimitEnabled]).toBe(true);
    expect(dst.store[SettingKey.QuietHoursStart]).toBe("23:15");
  });

  it("throws on invalid JSON payload and ignores invalid enums or malformed app rules", () => {
    const dst = memoryBackend({
      [SettingKey.ScreenshotThumbnailMode]: ThumbnailMode.Compact,
      [SettingKey.IndicatorPosition]: IndicatorPosition.Left,
      [SettingKey.AppRules]: JSON.stringify([
        { match: "slack", muted: true, maxCount: 0, expireSeconds: 0 },
      ]),
    });
    expect(() => importSettingsJson("not json", dst.backend)).toThrow();
    expect(() => importSettingsJson("{}", dst.backend)).toThrow();
    expect(() => importSettingsJson('{"settings":[]}', dst.backend)).toThrow();

    const count = importSettingsJson(
      JSON.stringify({
        settings: {
          [SettingKey.ScreenshotThumbnailMode]: "bogus",
          [SettingKey.IndicatorPosition]: "top",
          [SettingKey.AppRules]: "not-json",
          [SettingKey.QuietHoursStart]: "8:05",
        },
      }),
      dst.backend,
    );
    expect(count).toBe(1);
    expect(dst.store[SettingKey.ScreenshotThumbnailMode]).toBe(ThumbnailMode.Compact);
    expect(dst.store[SettingKey.IndicatorPosition]).toBe(IndicatorPosition.Left);
    expect(dst.store[SettingKey.AppRules]).toContain("slack");
    expect(dst.store[SettingKey.QuietHoursStart]).toBe("08:05");
  });
});

describe("QuietHoursController", () => {
  it("evaluates same-day and overnight windows accurately", () => {
    expect(parseTimeMinutes("22:00")).toBe(22 * 60);
    expect(parseTimeMinutes("invalid")).toBeNull();
    expect(formatTimeMinutes(8, 5)).toBe("08:05");
    expect(formatTimeMinutes(Number.NaN, Number.POSITIVE_INFINITY)).toBe("00:00");

    // Overnight: 22:00 -> 08:00
    expect(isWithinQuietHours(23 * 60, 22 * 60, 8 * 60)).toBe(true);
    expect(isWithinQuietHours(3 * 60, 22 * 60, 8 * 60)).toBe(true);
    expect(isWithinQuietHours(12 * 60, 22 * 60, 8 * 60)).toBe(false);

    // Same-day: 13:00 -> 15:00
    expect(isWithinQuietHours(14 * 60, 13 * 60, 15 * 60)).toBe(true);
    expect(isWithinQuietHours(16 * 60, 13 * 60, 15 * 60)).toBe(false);
  });

  it("enables DND inside quiet hours and restores only when managed by schedule", () => {
    let showBanners = true;
    let nowMinutes = 21 * 60;
    const scheduler = new FakeScheduler();
    const controller = new QuietHoursController(
      () => ({ enabled: true, start: "22:00", end: "08:00" }),
      {
        getShowBanners: () => showBanners,
        setShowBanners: (v) => {
          showBanners = v;
        },
      },
      scheduler,
      () => nowMinutes,
    );

    controller.start();
    expect(showBanners).toBe(true);

    nowMinutes = 23 * 60;
    scheduler.tick();
    expect(showBanners).toBe(false);

    nowMinutes = 9 * 60;
    scheduler.tick();
    expect(showBanners).toBe(true);

    // If user manually turned DND on before quiet hours, leaving quiet hours must NOT overwrite it.
    showBanners = false;
    nowMinutes = 23 * 60;
    scheduler.tick();
    nowMinutes = 9 * 60;
    scheduler.tick();
    expect(showBanners).toBe(false);

    controller.stop();
  });

  it("keeps DND active on screen-lock stop(false) and restores on invalid time config", () => {
    let showBanners = true;
    let start = "22:00";
    const scheduler = new FakeScheduler();
    const controller = new QuietHoursController(
      () => ({ enabled: true, start, end: "08:00" }),
      {
        getShowBanners: () => showBanners,
        setShowBanners: (v) => {
          showBanners = v;
        },
      },
      scheduler,
      () => 23 * 60,
    );

    controller.start();
    expect(showBanners).toBe(false);

    // Invalid time string restores managed DND instead of leaving it stuck on.
    start = "invalid";
    controller.sync();
    expect(showBanners).toBe(true);

    // Re-enter quiet hours, then simulate screen lock disable (restore=false) and unlock handoff.
    start = "22:00";
    controller.sync();
    expect(showBanners).toBe(false);
    const preserved = controller.isActivatedBySchedule;
    expect(preserved).toBe(true);
    controller.stop(false);
    expect(showBanners).toBe(false);

    // Unlocking after quiet hours ended restores DND immediately via preserved state.
    const afterUnlock = new QuietHoursController(
      () => ({ enabled: true, start: "22:00", end: "08:00" }),
      {
        getShowBanners: () => showBanners,
        setShowBanners: (v) => {
          showBanners = v;
        },
      },
      new FakeScheduler(),
      () => 9 * 60,
      preserved,
    );
    afterUnlock.start();
    expect(showBanners).toBe(true);
    afterUnlock.stop();
  });
});
