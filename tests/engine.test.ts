import { describe, expect, it } from "vitest";

import { Engine } from "../src/engine.js";
import type { Bridge } from "../src/shell-bridge.js";
import { CapabilityTier, SourceKey, ThumbnailMode } from "../src/types.js";
import { FakeHandle, FakeScheduler, makeBridge, makeSettings, makeSettingsStore } from "./fakes.js";

describe("Engine", () => {
  it("applies notifyEnabled=false on arrival, without waiting for a sweep", () => {
    const settings = makeSettings({ notifyEnabled: false });
    const handle = new FakeHandle(1, SourceKey.Screenshot, 0);
    const notification = {};
    const bridge = makeBridge(new Map([[1, handle]]), new Map([[notification, 1]]));
    const engine = new Engine(
      makeSettingsStore(settings),
      bridge,
      "v46",
      CapabilityTier.TopBar,
      new FakeScheduler(),
    );

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
      CapabilityTier.TopBar,
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
      CapabilityTier.TopBar,
      new FakeScheduler(),
    );

    expect(engine.start()).toBe(false);
    expect(() => engine.stop()).not.toThrow();
  });

  it("removes destroyed notifications from its tracking", () => {
    const handle = new FakeHandle(1, SourceKey.Screenshot, 0);
    const notification = {};
    const bridge = makeBridge(new Map([[1, handle]]), new Map([[notification, 1]]));
    const engine = new Engine(
      makeSettingsStore(makeSettings()),
      bridge,
      "v46",
      CapabilityTier.TopBar,
      new FakeScheduler(),
    );

    engine.onNotificationAdded(notification);
    expect(engine.getStats().activeCount).toBe(1);

    engine.onNotificationDestroyed(notification);
    expect(engine.getStats().activeCount).toBe(0);
  });

  it("tolerates repeated destroy notifications for the same object", () => {
    const handle = new FakeHandle(1, SourceKey.Screenshot, 0);
    const notification = {};
    const bridge = makeBridge(new Map([[1, handle]]), new Map([[notification, 1]]));
    const engine = new Engine(
      makeSettingsStore(makeSettings()),
      bridge,
      "v46",
      CapabilityTier.TopBar,
      new FakeScheduler(),
    );

    engine.onNotificationAdded(notification);
    expect(() => {
      engine.onNotificationDestroyed(notification);
      engine.onNotificationDestroyed(notification);
    }).not.toThrow();
    expect(engine.getStats().activeCount).toBe(0);
  });

  it("clears only screenshot-sourced notifications, updates stats immediately, and never clears twice", () => {
    const shot = new FakeHandle(1, SourceKey.Screenshot, 0, 1024);
    const other = new FakeHandle(2, SourceKey.Other, 0, 512);
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
      sourceKeyFor: (notification) =>
        notification === shotNotification ? SourceKey.Screenshot : SourceKey.Other,
    };
    const engine = new Engine(
      makeSettingsStore(makeSettings()),
      bridge,
      "v46",
      CapabilityTier.TopBar,
      new FakeScheduler(),
    );

    engine.onNotificationAdded(shotNotification);
    engine.onNotificationAdded(otherNotification);
    expect(engine.getStats().activeCount).toBe(2);

    engine.clearScreenshots();
    expect(engine.getStats().activeCount).toBe(1);
    expect(engine.getStats().estimatedBytes).toBe(512);

    engine.clearScreenshots();
    expect(shot.destroyCalls).toBe(1);
    expect(other.destroyed).toBe(false);
  });

  it("re-evaluates existing handles immediately when settings change", () => {
    const settings = makeSettings();
    const store = makeSettingsStore(settings);
    const handle = new FakeHandle(1, SourceKey.Screenshot, 0);
    const notification = {};
    const bridge = makeBridge(new Map([[1, handle]]), new Map([[notification, 1]]));
    const engine = new Engine(store, bridge, "v46", CapabilityTier.TopBar, new FakeScheduler());

    engine.start();
    engine.onNotificationAdded(notification);
    expect(handle.destroyed).toBe(false);

    settings.notifyEnabled = false;
    store.notify();
    expect(handle.destroyed).toBe(true);
    expect(engine.getStats().activeCount).toBe(0);
  });

  it("tracks peak bytes, pruned count and adapter metadata", () => {
    const settings = makeSettings({ maxCount: 1 });
    const first = new FakeHandle(1, SourceKey.Screenshot, 1, 1024);
    const second = new FakeHandle(2, SourceKey.Screenshot, 2, 2048);
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
    const engine = new Engine(
      makeSettingsStore(settings),
      bridge,
      "v46",
      CapabilityTier.TopBar,
      new FakeScheduler(),
    );

    engine.onNotificationAdded(firstNotification);
    engine.onNotificationAdded(secondNotification);

    const stats = engine.getStats();
    expect(stats.peakBytes).toBe(2048);
    expect(stats.prunedCount).toBe(1);
    expect(stats.adapterId).toBe("v46");
    expect(stats.tier).toBe(CapabilityTier.TopBar);
  });

  it("clears tracking on stop", () => {
    const handle = new FakeHandle(1, SourceKey.Screenshot, 0);
    const notification = {};
    const bridge = makeBridge(new Map([[1, handle]]), new Map([[notification, 1]]));
    const engine = new Engine(
      makeSettingsStore(makeSettings()),
      bridge,
      "v46",
      CapabilityTier.TopBar,
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
      CapabilityTier.TopBar,
      new FakeScheduler(),
    );

    engine.setGuardEnabled(false);
    engine.setNotifyEnabled(false);
    engine.setMaxCount(7);

    expect(settings.guardEnabled).toBe(false);
    expect(settings.notifyEnabled).toBe(false);
    expect(settings.maxCount).toBe(7);
  });

  it("reports zero estimated bytes after a text-only downgrade", () => {
    const handle = new FakeHandle(1, SourceKey.Screenshot, 0, 1024);
    const notification = {};
    const bridge = makeBridge(new Map([[1, handle]]), new Map([[notification, 1]]));
    const engine = new Engine(
      makeSettingsStore(makeSettings({ thumbnailMode: ThumbnailMode.TextOnly })),
      bridge,
      "v46",
      CapabilityTier.TopBar,
      new FakeScheduler(),
    );

    engine.onNotificationAdded(notification);

    expect(handle.downgraded).toBe(true);
    expect(engine.getStats().estimatedBytes).toBe(0);
  });

  it("compacts thumbnails on arrival in compact mode and reports compact bytes", () => {
    const handle = new FakeHandle(1, SourceKey.Screenshot, 0, 32 * 1024 * 1024);
    const notification = {};
    const bridge = makeBridge(new Map([[1, handle]]), new Map([[notification, 1]]));
    const engine = new Engine(
      makeSettingsStore(makeSettings({ thumbnailMode: ThumbnailMode.Compact })),
      bridge,
      "v46",
      CapabilityTier.TopBar,
      new FakeScheduler(),
    );

    engine.onNotificationAdded(notification);

    expect(handle.compacted).toBe(true);
    expect(handle.compactCalls).toBe(1);
    expect(engine.getStats().estimatedBytes).toBe(36_864);
    expect(engine.getStats().estimatedBytes).toBeLessThan(100_000);
  });

  it("reflects updated bytes in getStats() after async compaction finishes", () => {
    const handle = new FakeHandle(
      1,
      SourceKey.Screenshot,
      0,
      32 * 1024 * 1024,
      false,
      false,
      true,
      false,
      32 * 1024 * 1024,
    );
    const notification = {};
    const bridge = makeBridge(new Map([[1, handle]]), new Map([[notification, 1]]));
    const engine = new Engine(
      makeSettingsStore(makeSettings({ thumbnailMode: ThumbnailMode.Compact })),
      bridge,
      "v46",
      CapabilityTier.TopBar,
      new FakeScheduler(),
    );

    engine.onNotificationAdded(notification);
    expect(handle.compacted).toBe(true);

    // Simulate async clipboard decode completing with compact size.
    handle.setCompactBytes(40_960);
    expect(engine.getStats().estimatedBytes).toBe(40_960);
  });

  it("does not panic when compact throws", () => {
    const handle = new FakeHandle(
      1,
      SourceKey.Screenshot,
      0,
      1024,
      false,
      false,
      true,
      false,
      36_864,
      true,
    );
    const notification = {};
    const bridge = makeBridge(new Map([[1, handle]]), new Map([[notification, 1]]));
    const engine = new Engine(
      makeSettingsStore(makeSettings({ thumbnailMode: ThumbnailMode.Compact })),
      bridge,
      "v46",
      CapabilityTier.TopBar,
      new FakeScheduler(),
    );

    expect(() => engine.onNotificationAdded(notification)).not.toThrow();
    expect(handle.compactCalls).toBe(1);
    expect(engine.getStats().activeCount).toBe(1);
  });

  it("adopts notifications via bridge.adoptExisting during sweep", () => {
    const handle = new FakeHandle(1, SourceKey.Screenshot, 0);
    const notification = {};
    let addedCb: ((n: unknown) => void) | null = null;
    const bridge: Bridge = {
      ...makeBridge(new Map([[1, handle]]), new Map([[notification, 1]])),
      start: (onAdded) => {
        addedCb = onAdded;
        return true;
      },
      adoptExisting: () => {
        addedCb?.(notification);
      },
    };
    const engine = new Engine(
      makeSettingsStore(makeSettings()),
      bridge,
      "v46",
      CapabilityTier.TopBar,
      new FakeScheduler(),
    );

    engine.start();
    engine.sweep();

    expect(engine.getStats().activeCount).toBe(1);
    expect(handle.destroyed).toBe(false);
  });

  it("does not panic when settings cannot be read", () => {
    const brokenStore = {
      read: () => {
        throw new Error("schema missing");
      },
      onChanged: () => () => {},
      setGuardEnabled: () => {},
      setNotifyEnabled: () => {},
      setMaxCount: () => {},
      dispose: () => {},
    };
    const engine = new Engine(
      brokenStore as never,
      makeBridge(new Map(), new Map()),
      "v46",
      CapabilityTier.TopBar,
      new FakeScheduler(),
    );

    expect(() => engine.sweep()).not.toThrow();
    expect(engine.getStats().activeCount).toBe(0);
  });

  it("applies expiry and max-count rules across scheduled sweeps", () => {
    const now = Date.now();
    const settings = makeSettings({ expireSeconds: 10, maxCount: 1 });
    const old = new FakeHandle(1, SourceKey.Screenshot, now - 20_000);
    const fresh = new FakeHandle(2, SourceKey.Screenshot, now);
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
    const engine = new Engine(
      makeSettingsStore(settings),
      bridge,
      "v46",
      CapabilityTier.TopBar,
      scheduler,
    );

    engine.onNotificationAdded(oldNotification);
    engine.onNotificationAdded(freshNotification);
    engine.start();
    scheduler.tick();

    expect(old.destroyed).toBe(true);
    expect(fresh.destroyed).toBe(false);
    expect(engine.getStats().activeCount).toBe(1);
  });

  it("does not count a failed destroy as pruned", () => {
    const handle = new FakeHandle(1, SourceKey.Screenshot, 0, 0, false, false, true, true);
    const notification = {};
    const bridge = makeBridge(new Map([[1, handle]]), new Map([[notification, 1]]));
    const engine = new Engine(
      makeSettingsStore(makeSettings({ notifyEnabled: false })),
      bridge,
      "v46",
      CapabilityTier.TopBar,
      new FakeScheduler(),
    );

    expect(() => engine.onNotificationAdded(notification)).not.toThrow();
    expect(handle.destroyed).toBe(false);
    expect(engine.getStats().activeCount).toBe(1);
    expect(engine.getStats().prunedCount).toBe(0);
  });

  it("expires non-screenshot transient notifications under DND via TransientRule", () => {
    const now = Date.now();
    let dnd = false;
    const transient = new FakeHandle(1, SourceKey.Other, now - 60_000, 0, false, false, true);
    const notification = {};
    const bridge: Bridge = {
      ...makeBridge(new Map([[1, transient]]), new Map([[notification, 1]])),
      sourceKeyFor: () => SourceKey.Other,
      isDoNotDisturb: () => dnd,
    };
    const scheduler = new FakeScheduler();
    const engine = new Engine(
      makeSettingsStore(
        makeSettings({
          transientExpireEnabled: true,
          transientExpireSeconds: 30,
          transientDndOnly: true,
        }),
      ),
      bridge,
      "v46",
      CapabilityTier.TopBar,
      scheduler,
    );

    engine.start();
    engine.onNotificationAdded(notification);
    scheduler.tick();
    expect(transient.destroyed).toBe(false);

    dnd = true;
    scheduler.tick();
    expect(transient.destroyed).toBe(true);
    expect(engine.getStats().activeCount).toBe(0);
    expect(engine.getStats().prunedCount).toBe(1);
  });

  it("enforces global retention cap across mixed notification sources", () => {
    const oldest = new FakeHandle(1, SourceKey.Other, 10, 0, false, false, false);
    const newer = new FakeHandle(2, SourceKey.Other, 20, 0, false, false, false);
    const notifications = new Map<unknown, number>([
      [{}, 1],
      [{}, 2],
    ]);
    const [oldestNotification, newerNotification] = [...notifications.keys()];
    const bridge: Bridge = {
      ...makeBridge(
        new Map([
          [1, oldest],
          [2, newer],
        ]),
        notifications,
      ),
      sourceKeyFor: () => SourceKey.Other,
    };
    const engine = new Engine(
      makeSettingsStore(makeSettings({ globalMaxCount: 1 })),
      bridge,
      "v46",
      CapabilityTier.TopBar,
      new FakeScheduler(),
    );

    engine.onNotificationAdded(oldestNotification);
    engine.onNotificationAdded(newerNotification);

    expect(oldest.destroyed).toBe(true);
    expect(newer.destroyed).toBe(false);
    expect(engine.getStats().activeCount).toBe(1);
    expect(engine.getStats().prunedCount).toBe(1);
  });

  it("discards screencast notifications on arrival when screencastNotifyEnabled is false", () => {
    const cast = new FakeHandle(1, SourceKey.Screencast, 0);
    const notification = {};
    const bridge: Bridge = {
      ...makeBridge(new Map([[1, cast]]), new Map([[notification, 1]])),
      sourceKeyFor: () => SourceKey.Screencast,
    };
    const engine = new Engine(
      makeSettingsStore(makeSettings({ screencastNotifyEnabled: false })),
      bridge,
      "v46",
      CapabilityTier.TopBar,
      new FakeScheduler(),
    );

    engine.onNotificationAdded(notification);

    expect(cast.destroyed).toBe(true);
    expect(engine.getStats().activeCount).toBe(0);
    expect(engine.getStats().prunedCount).toBe(1);
  });

  it("accumulates savedBytes across compact, downgrade, and destroy without double counting", () => {
    const first = new FakeHandle(1, SourceKey.Screenshot, 10, 10_000_000);
    const second = new FakeHandle(2, SourceKey.Screenshot, 20, 5_000_000);
    const notifications = new Map<unknown, number>([
      [{}, 1],
      [{}, 2],
    ]);
    const [firstNotif, secondNotif] = [...notifications.keys()];
    const settings = makeSettings({ thumbnailMode: ThumbnailMode.Compact });
    const store = makeSettingsStore(settings);
    const bridge = makeBridge(
      new Map([
        [1, first],
        [2, second],
      ]),
      notifications,
    );
    const engine = new Engine(store, bridge, "v46", CapabilityTier.TopBar, new FakeScheduler());

    engine.onNotificationAdded(firstNotif);
    // Compacted from 10_000_000 -> 36_864
    expect(engine.getStats().savedBytes).toBe(10_000_000 - 36_864);
    // Calling getStats() again must not double-count.
    expect(engine.getStats().savedBytes).toBe(10_000_000 - 36_864);

    // Switching to text-only frees the remaining 36_864 on first, and 5_000_000 on second.
    settings.thumbnailMode = ThumbnailMode.TextOnly;
    engine.onNotificationAdded(secondNotif);
    expect(engine.getStats().savedBytes).toBe(15_000_000);

    // Destroying already-downgraded (0 B) handles adds 0.
    engine.clearScreenshots();
    expect(engine.getStats().savedBytes).toBe(15_000_000);
  });
});
