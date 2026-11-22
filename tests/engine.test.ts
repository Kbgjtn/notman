import { describe, expect, it } from "vitest";

import { Engine } from "../src/engine.js";
import type { Bridge } from "../src/shell-bridge.js";
import { FakeHandle, FakeScheduler, makeBridge, makeSettings, makeSettingsStore } from "./fakes.js";

describe("Engine", () => {
  it("applies notifyEnabled=false on arrival, without waiting for a sweep", () => {
    const settings = makeSettings({ notifyEnabled: false });
    const handle = new FakeHandle(1, "screenshot", 0);
    const notification = {};
    const bridge = makeBridge(new Map([[1, handle]]), new Map([[notification, 1]]));
    const engine = new Engine(makeSettingsStore(settings), bridge, "v46", 2, new FakeScheduler());

    engine.onNotificationAdded(notification);

    expect(handle.destroyed).toBe(true);
    expect(engine.getStats().activeCount).toBe(0);
    expect(engine.getStats().prunedCount).toBe(1);
  });

  it("ignores a notification the bridge cannot wrap", () => {
    const bridge: Bridge = {
      ...makeBridge(new Map(), new Map()),
      makeHandle: () => null,
    };
    const engine = new Engine(
      makeSettingsStore(makeSettings()),
      bridge,
      "v46",
      2,
      new FakeScheduler(),
    );

    expect(() => engine.onNotificationAdded({})).not.toThrow();
    expect(engine.getStats().activeCount).toBe(0);
  });

  it("does not start when the bridge cannot observe the tray", () => {
    const bridge: Bridge = {
      ...makeBridge(new Map(), new Map()),
      start: () => false,
    };
    const engine = new Engine(
      makeSettingsStore(makeSettings()),
      bridge,
      "v46",
      2,
      new FakeScheduler(),
    );

    expect(engine.start()).toBe(false);
    expect(() => engine.stop()).not.toThrow();
  });

  it("removes destroyed notifications from its tracking", () => {
    const handle = new FakeHandle(1, "screenshot", 0);
    const notification = {};
    const bridge = makeBridge(new Map([[1, handle]]), new Map([[notification, 1]]));
    const engine = new Engine(
      makeSettingsStore(makeSettings()),
      bridge,
      "v46",
      2,
      new FakeScheduler(),
    );

    engine.onNotificationAdded(notification);
    expect(engine.getStats().activeCount).toBe(1);

    engine.onNotificationDestroyed(notification);
    expect(engine.getStats().activeCount).toBe(0);
  });

  it("tolerates repeated destroy notifications for the same object", () => {
    const handle = new FakeHandle(1, "screenshot", 0);
    const notification = {};
    const bridge = makeBridge(new Map([[1, handle]]), new Map([[notification, 1]]));
    const engine = new Engine(
      makeSettingsStore(makeSettings()),
      bridge,
      "v46",
      2,
      new FakeScheduler(),
    );

    engine.onNotificationAdded(notification);
    expect(() => {
      engine.onNotificationDestroyed(notification);
      engine.onNotificationDestroyed(notification);
    }).not.toThrow();
    expect(engine.getStats().activeCount).toBe(0);
  });

  it("clears only screenshot-sourced notifications and never twice", () => {
    const shot = new FakeHandle(1, "screenshot", 0);
    const other = new FakeHandle(2, "other", 0);
    const notifications = new Map<unknown, number>([
      [{}, 1],
      [{}, 2],
    ]);
    const [shotNotification, otherNotification] = [...notifications.keys()];
    const bridge: Bridge = {
      ...makeBridge(
        new Map([
          [1, shot],
          [2, other],
        ]),
        notifications,
      ),
      sourceKeyFor: (notification) => (notification === shotNotification ? "screenshot" : "other"),
    };
    const engine = new Engine(
      makeSettingsStore(makeSettings()),
      bridge,
      "v46",
      2,
      new FakeScheduler(),
    );

    engine.onNotificationAdded(shotNotification);
    engine.onNotificationAdded(otherNotification);
    engine.clearScreenshots();
    engine.clearScreenshots();

    expect(shot.destroyCalls).toBe(1);
    expect(other.destroyed).toBe(false);
  });

  it("re-evaluates existing handles when settings change", () => {
    const settings = makeSettings();
    const handle = new FakeHandle(1, "screenshot", 0);
    const notification = {};
    const bridge = makeBridge(new Map([[1, handle]]), new Map([[notification, 1]]));
    const engine = new Engine(makeSettingsStore(settings), bridge, "v46", 2, new FakeScheduler());

    engine.onNotificationAdded(notification);
    expect(handle.destroyed).toBe(false);

    engine.setEnabled(false);
    expect(handle.destroyed).toBe(true);
  });

  it("tracks peak bytes, pruned count and adapter metadata", () => {
    const settings = makeSettings({ maxCount: 1 });
    const first = new FakeHandle(1, "screenshot", 1, 1024);
    const second = new FakeHandle(2, "screenshot", 2, 2048);
    const notifications = new Map<unknown, number>([
      [{}, 1],
      [{}, 2],
    ]);
    const [firstNotification, secondNotification] = [...notifications.keys()];
    const bridge = makeBridge(
      new Map([
        [1, first],
        [2, second],
      ]),
      notifications,
    );
    const engine = new Engine(makeSettingsStore(settings), bridge, "v46", 2, new FakeScheduler());

    engine.onNotificationAdded(firstNotification);
    engine.onNotificationAdded(secondNotification);

    const stats = engine.getStats();
    expect(stats.peakBytes).toBe(2048);
    expect(stats.prunedCount).toBe(1);
    expect(stats.adapterId).toBe("v46");
    expect(stats.tier).toBe(2);
  });

  it("clears tracking on stop", () => {
    const handle = new FakeHandle(1, "screenshot", 0);
    const notification = {};
    const bridge = makeBridge(new Map([[1, handle]]), new Map([[notification, 1]]));
    const engine = new Engine(
      makeSettingsStore(makeSettings()),
      bridge,
      "v46",
      2,
      new FakeScheduler(),
    );

    engine.onNotificationAdded(notification);
    engine.stop();

    expect(engine.getStats().activeCount).toBe(0);
  });

  it("updates settings through its public API", () => {
    const settings = makeSettings();
    const engine = new Engine(
      makeSettingsStore(settings),
      makeBridge(new Map(), new Map()),
      "v46",
      2,
      new FakeScheduler(),
    );

    engine.setEnabled(false);
    engine.setMaxCount(7);

    expect(settings.notifyEnabled).toBe(false);
    expect(settings.maxCount).toBe(7);
  });

  it("does not panic when settings cannot be read", () => {
    const brokenStore = {
      read: () => {
        throw new Error("schema missing");
      },
      setNotifyEnabled: () => {},
      setMaxCount: () => {},
    };
    const engine = new Engine(
      brokenStore as never,
      makeBridge(new Map(), new Map()),
      "v46",
      2,
      new FakeScheduler(),
    );

    expect(() => engine.sweep()).not.toThrow();
    expect(engine.getStats().activeCount).toBe(0);
  });

  it("applies expiry and max-count rules across scheduled sweeps", () => {
    const now = Date.now();
    const settings = makeSettings({ expireSeconds: 10, maxCount: 1 });
    const old = new FakeHandle(1, "screenshot", now - 20_000);
    const fresh = new FakeHandle(2, "screenshot", now);
    const notifications = new Map<unknown, number>([
      [{}, 1],
      [{}, 2],
    ]);
    const [oldNotification, freshNotification] = [...notifications.keys()];
    const bridge = makeBridge(
      new Map([
        [1, old],
        [2, fresh],
      ]),
      notifications,
    );
    const scheduler = new FakeScheduler();
    const engine = new Engine(makeSettingsStore(settings), bridge, "v46", 2, scheduler);

    engine.onNotificationAdded(oldNotification);
    engine.onNotificationAdded(freshNotification);
    engine.start();
    scheduler.tick();

    expect(old.destroyed).toBe(true);
    expect(fresh.destroyed).toBe(false);
    expect(engine.getStats().activeCount).toBe(1);
  });

  it("does not count a failed destroy as pruned", () => {
    const handle = new FakeHandle(1, "screenshot", 0, 0, false, false, true, true);
    const notification = {};
    const bridge = makeBridge(new Map([[1, handle]]), new Map([[notification, 1]]));
    const engine = new Engine(
      makeSettingsStore(makeSettings({ notifyEnabled: false })),
      bridge,
      "v46",
      2,
      new FakeScheduler(),
    );

    expect(() => engine.onNotificationAdded(notification)).not.toThrow();
    expect(handle.destroyed).toBe(false);
    expect(engine.getStats().activeCount).toBe(1);
    expect(engine.getStats().prunedCount).toBe(0);
  });
});
