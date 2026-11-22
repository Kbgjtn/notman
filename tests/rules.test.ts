import { describe, expect, it } from "vitest";

import { MiB } from "../src/byte-estimate.js";
import { CapRule } from "../src/rules/cap.js";
import { RetentionRule } from "../src/rules/retention.js";
import { ScreenshotRule } from "../src/rules/screenshot.js";
import { TransientRule } from "../src/rules/transient.js";
import { SourceKey, ThumbnailMode } from "../src/types.js";
import { FakeHandle, makeContext, makeSettings } from "./fakes.js";

describe("ScreenshotRule", () => {
  const rule = new ScreenshotRule();

  it("handles an empty list", () => {
    const outcome = rule.evaluate([], makeContext(makeSettings()));
    expect(outcome.destroy).toEqual([]);
    expect(outcome.downgrade).toEqual([]);
  });

  it("does nothing when the guard is off", () => {
    const handles = [new FakeHandle(1, SourceKey.Screenshot, 0, MiB)];
    const outcome = rule.evaluate(handles, makeContext(makeSettings({ guardEnabled: false })));
    expect(outcome.destroy).toEqual([]);
    expect(outcome.downgrade).toEqual([]);
  });

  it("is inert when every numeric limit is zero", () => {
    const handles = [new FakeHandle(1, SourceKey.Screenshot, 0, MiB)];
    const outcome = rule.evaluate(
      handles,
      makeContext(makeSettings({ maxCount: 0, expireSeconds: 0, memoryBudgetMb: 0 })),
    );
    expect(outcome.destroy).toEqual([]);
  });

  it("destroys every screenshot notification when notifications are off", () => {
    const shot = new FakeHandle(1, SourceKey.Screenshot, 0);
    const other = new FakeHandle(2, SourceKey.Other, 0);
    const outcome = rule.evaluate(
      [shot, other],
      makeContext(makeSettings({ notifyEnabled: false })),
    );
    expect(outcome.destroy).toEqual([shot]);
  });

  it("ignores non-screenshot sources entirely", () => {
    const other = new FakeHandle(1, SourceKey.Other, 0, MiB);
    const outcome = rule.evaluate(
      [other],
      makeContext(makeSettings({ notifyEnabled: false, thumbnailMode: ThumbnailMode.TextOnly })),
    );
    expect(outcome.destroy).toEqual([]);
    expect(outcome.downgrade).toEqual([]);
  });

  it("downgrades thumbnails in text-only mode", () => {
    const shot = new FakeHandle(1, SourceKey.Screenshot, 0);
    const outcome = rule.evaluate(
      [shot],
      makeContext(makeSettings({ thumbnailMode: ThumbnailMode.TextOnly })),
    );
    expect(outcome.downgrade).toEqual([shot]);
  });

  it("does not re-downgrade an already downgraded handle", () => {
    const shot = new FakeHandle(1, SourceKey.Screenshot, 0);
    shot.downgrade();
    const outcome = rule.evaluate(
      [shot],
      makeContext(makeSettings({ thumbnailMode: ThumbnailMode.TextOnly })),
    );
    expect(outcome.downgrade).toEqual([]);
  });

  it("compacts thumbnails in compact mode", () => {
    const shot = new FakeHandle(1, SourceKey.Screenshot, 0, 32 * MiB);
    const outcome = rule.evaluate(
      [shot],
      makeContext(makeSettings({ thumbnailMode: ThumbnailMode.Compact })),
    );
    expect(outcome.compact).toEqual([shot]);
    expect(outcome.downgrade).toEqual([]);
  });

  it("does not re-compact an already compacted or downgraded handle", () => {
    const compacted = new FakeHandle(1, SourceKey.Screenshot, 0, 32 * MiB);
    compacted.compact();
    const downgraded = new FakeHandle(2, SourceKey.Screenshot, 10, 32 * MiB);
    downgraded.downgrade();
    const outcome = rule.evaluate(
      [compacted, downgraded],
      makeContext(makeSettings({ thumbnailMode: ThumbnailMode.Compact })),
    );
    expect(outcome.compact).toEqual([]);
  });

  it("does not compact handles that are already scheduled for destruction", () => {
    const handles = [
      new FakeHandle(1, SourceKey.Screenshot, 10, 32 * MiB),
      new FakeHandle(2, SourceKey.Screenshot, 20, 32 * MiB),
    ];
    const outcome = rule.evaluate(
      handles,
      makeContext(makeSettings({ thumbnailMode: ThumbnailMode.Compact, maxCount: 1 })),
    );
    expect(outcome.destroy.map((h) => h.id)).toEqual([1]);
    expect(outcome.compact.map((h) => h.id)).toEqual([2]);
  });

  it("does not over-prune for the budget when thumbnails will be compacted", () => {
    const handles = [1, 2, 3].map((id) => new FakeHandle(id, SourceKey.Screenshot, id, 32 * MiB));
    const outcome = rule.evaluate(
      handles,
      makeContext(makeSettings({ thumbnailMode: ThumbnailMode.Compact, memoryBudgetMb: 1 })),
    );
    expect(outcome.compact).toHaveLength(3);
    expect(outcome.destroy).toEqual([]);
  });

  it("enforces memory budget across already-compacted handles using their compact size", () => {
    const handles = [1, 2, 3].map((id) => {
      const h = new FakeHandle(
        id,
        SourceKey.Screenshot,
        id,
        32 * MiB,
        false,
        false,
        true,
        false,
        600 * 1024,
      );
      h.compact();
      return h;
    });
    const outcome = rule.evaluate(
      handles,
      makeContext(makeSettings({ thumbnailMode: ThumbnailMode.Compact, memoryBudgetMb: 1 })),
    );
    expect(outcome.destroy.map((h) => h.id)).toEqual([1, 2]);
    expect(outcome.compact).toEqual([]);
  });

  it("downgrades previously compacted handles when switched to text-only mode", () => {
    const shot = new FakeHandle(1, SourceKey.Screenshot, 0, 32 * MiB);
    shot.compact();
    const outcome = rule.evaluate(
      [shot],
      makeContext(makeSettings({ thumbnailMode: ThumbnailMode.TextOnly })),
    );
    expect(outcome.downgrade).toEqual([shot]);
  });

  it("destroys oldest notifications beyond max-count", () => {
    const handles = [
      new FakeHandle(1, SourceKey.Screenshot, 10),
      new FakeHandle(2, SourceKey.Screenshot, 20),
      new FakeHandle(3, SourceKey.Screenshot, 30),
      new FakeHandle(4, SourceKey.Screenshot, 40),
    ];
    const outcome = rule.evaluate(handles, makeContext(makeSettings({ maxCount: 2 })));
    expect(outcome.destroy.map((h) => h.id)).toEqual([1, 2]);
  });

  it("keeps exactly one notification when max-count is one", () => {
    const handles = [
      new FakeHandle(1, SourceKey.Screenshot, 10),
      new FakeHandle(2, SourceKey.Screenshot, 20),
    ];
    const outcome = rule.evaluate(handles, makeContext(makeSettings({ maxCount: 1 })));
    expect(outcome.destroy.map((h) => h.id)).toEqual([1]);
  });

  it("destroys notifications older than the expiry window", () => {
    const old = new FakeHandle(1, SourceKey.Screenshot, 1000);
    const fresh = new FakeHandle(2, SourceKey.Screenshot, 19_000);
    const outcome = rule.evaluate(
      [old, fresh],
      makeContext(makeSettings({ expireSeconds: 10 }), 20_000),
    );
    expect(outcome.destroy).toEqual([old]);
  });

  it("prunes oldest until the memory budget is met", () => {
    const handles = [
      new FakeHandle(1, SourceKey.Screenshot, 10, 600 * 1024),
      new FakeHandle(2, SourceKey.Screenshot, 20, 600 * 1024),
      new FakeHandle(3, SourceKey.Screenshot, 30, 600 * 1024),
    ];
    const outcome = rule.evaluate(handles, makeContext(makeSettings({ memoryBudgetMb: 1 })));
    expect(outcome.destroy.map((h) => h.id)).toEqual([1, 2]);
  });

  it("does not prune when thumbnail sizes are unknown", () => {
    const handles = [1, 2, 3].map((id) => new FakeHandle(id, SourceKey.Screenshot, id, 0));
    const outcome = rule.evaluate(handles, makeContext(makeSettings({ memoryBudgetMb: 1 })));
    expect(outcome.destroy).toEqual([]);
  });

  it("does not return the same handle twice when rules overlap", () => {
    const old = new FakeHandle(1, SourceKey.Screenshot, 1000, MiB);
    const fresh = new FakeHandle(2, SourceKey.Screenshot, 19_000, MiB);
    const outcome = rule.evaluate(
      [old, fresh],
      makeContext(makeSettings({ expireSeconds: 10, maxCount: 1, memoryBudgetMb: 1 }), 20_000),
    );
    expect(outcome.destroy).toEqual([old]);
  });

  it("does not over-prune for the budget when thumbnails will be downgraded", () => {
    const handles = [1, 2, 3, 4].map((id) => new FakeHandle(id, SourceKey.Screenshot, id, MiB));
    const outcome = rule.evaluate(
      handles,
      makeContext(makeSettings({ thumbnailMode: ThumbnailMode.TextOnly, memoryBudgetMb: 1 })),
    );
    expect(outcome.downgrade).toHaveLength(4);
    expect(outcome.destroy).toEqual([]);
  });

  it("does not downgrade handles that are already scheduled for destruction", () => {
    const handles = [
      new FakeHandle(1, SourceKey.Screenshot, 10, MiB),
      new FakeHandle(2, SourceKey.Screenshot, 20, MiB),
      new FakeHandle(3, SourceKey.Screenshot, 30, MiB),
    ];
    const outcome = rule.evaluate(
      handles,
      makeContext(makeSettings({ thumbnailMode: ThumbnailMode.TextOnly, maxCount: 1 })),
    );
    expect(outcome.destroy.map((h) => h.id)).toEqual([1, 2]);
    expect(outcome.downgrade.map((h) => h.id)).toEqual([3]);
  });

  it("computes memory budget only across handles surviving expiry and maxCount", () => {
    const handles = [
      new FakeHandle(1, SourceKey.Screenshot, 1000, MiB),
      new FakeHandle(2, SourceKey.Screenshot, 19_000, 600 * 1024),
      new FakeHandle(3, SourceKey.Screenshot, 19_500, 300 * 1024),
    ];
    const outcome = rule.evaluate(
      handles,
      makeContext(makeSettings({ expireSeconds: 10, memoryBudgetMb: 1 }), 20_000),
    );
    expect(outcome.destroy.map((h) => h.id)).toEqual([1]);
  });

  it("keeps critical, feedback and currently shown notifications", () => {
    const critical = new FakeHandle(1, SourceKey.Screenshot, 10, 0, true);
    const feedback = new FakeHandle(2, SourceKey.Screenshot, 20, 0, false, true);
    const shown = new FakeHandle(3, SourceKey.Screenshot, 30);
    const normal = new FakeHandle(4, SourceKey.Screenshot, 40);
    const outcome = rule.evaluate(
      [critical, feedback, shown, normal],
      makeContext(makeSettings({ notifyEnabled: false }), 1_000_000, 3),
    );
    expect(outcome.destroy).toEqual([normal]);
  });
});

describe("CapRule", () => {
  const rule = new CapRule();

  it("handles an empty list", () => {
    expect(rule.evaluate([], makeContext(makeSettings({ emergencyHardCap: 1 }))).destroy).toEqual(
      [],
    );
  });

  it("destroys the oldest handles beyond the hard cap", () => {
    const handles = [1, 2, 3, 4, 5].map((id) => new FakeHandle(id, SourceKey.Screenshot, id));
    const outcome = rule.evaluate(handles, makeContext(makeSettings({ emergencyHardCap: 2 })));
    expect(outcome.destroy.map((h) => h.id)).toEqual([1, 2, 3]);
  });

  it("is inert when the cap is zero, the guard is off, or nothing exceeds it", () => {
    const handles = [new FakeHandle(1, SourceKey.Screenshot, 1)];
    expect(
      rule.evaluate(handles, makeContext(makeSettings({ emergencyHardCap: 0 }))).destroy,
    ).toEqual([]);
    expect(
      rule.evaluate(
        handles,
        makeContext(makeSettings({ emergencyHardCap: 1, guardEnabled: false })),
      ).destroy,
    ).toEqual([]);
    expect(
      rule.evaluate(handles, makeContext(makeSettings({ emergencyHardCap: 5 }))).destroy,
    ).toEqual([]);
  });

  it("never destroys protected handles, even when over the cap", () => {
    const critical = new FakeHandle(1, SourceKey.Screenshot, 1, 0, true);
    const feedback = new FakeHandle(2, SourceKey.Screenshot, 2, 0, false, true);
    const shown = new FakeHandle(3, SourceKey.Screenshot, 3);
    const outcome = rule.evaluate(
      [critical, feedback, shown],
      makeContext(makeSettings({ emergencyHardCap: 1 }), 1_000_000, 3),
    );
    expect(outcome.destroy).toEqual([]);
  });

  it("never destroys persistent non-screenshot notifications", () => {
    const persistent1 = new FakeHandle(1, SourceKey.Other, 1, 0, false, false, false);
    const persistent2 = new FakeHandle(2, SourceKey.Other, 2, 0, false, false, false);
    const transient = new FakeHandle(3, SourceKey.Other, 3, 0, false, false, true);
    const outcome = rule.evaluate(
      [persistent1, persistent2, transient],
      makeContext(makeSettings({ emergencyHardCap: 1 })),
    );
    expect(outcome.destroy).toEqual([]);
  });
});

describe("TransientRule", () => {
  const rule = new TransientRule();

  it("does nothing when disabled or guard is off", () => {
    const old = new FakeHandle(1, SourceKey.Other, 0, 0, false, false, true);
    expect(
      rule.evaluate([old], makeContext(makeSettings({ transientExpireEnabled: false }), 100_000))
        .destroy,
    ).toEqual([]);
    expect(
      rule.evaluate(
        [old],
        makeContext(makeSettings({ guardEnabled: false, transientExpireEnabled: true }), 100_000),
      ).destroy,
    ).toEqual([]);
  });

  it("respects transientDndOnly when DND is off", () => {
    const old = new FakeHandle(1, SourceKey.Other, 0, 0, false, false, true);
    const dndOff = rule.evaluate(
      [old],
      makeContext(
        makeSettings({
          transientExpireEnabled: true,
          transientExpireSeconds: 30,
          transientDndOnly: true,
        }),
        60_000,
        null,
        false,
      ),
    );
    expect(dndOff.destroy).toEqual([]);

    const dndNotRequired = rule.evaluate(
      [old],
      makeContext(
        makeSettings({
          transientExpireEnabled: true,
          transientExpireSeconds: 30,
          transientDndOnly: false,
        }),
        60_000,
        null,
        false,
      ),
    );
    expect(dndNotRequired.destroy).toEqual([old]);
  });

  it("expires only non-screenshot transient handles past the cutoff under DND", () => {
    const expired = new FakeHandle(1, SourceKey.Other, 10_000, 0, false, false, true);
    const fresh = new FakeHandle(2, SourceKey.Other, 50_000, 0, false, false, true);
    const persistent = new FakeHandle(3, SourceKey.Other, 10_000, 0, false, false, false);
    const screenshot = new FakeHandle(4, SourceKey.Screenshot, 10_000, 0, false, false, true);
    const outcome = rule.evaluate(
      [expired, fresh, persistent, screenshot],
      makeContext(
        makeSettings({
          transientExpireEnabled: true,
          transientExpireSeconds: 30,
          transientDndOnly: true,
        }),
        60_000,
        null,
        true,
      ),
    );
    expect(outcome.destroy).toEqual([expired]);
  });

  it("never destroys critical, feedback, or currently shown transient handles", () => {
    const critical = new FakeHandle(1, SourceKey.Other, 0, 0, true, false, true);
    const feedback = new FakeHandle(2, SourceKey.Other, 0, 0, false, true, true);
    const shown = new FakeHandle(3, SourceKey.Other, 0, 0, false, false, true);
    const normal = new FakeHandle(4, SourceKey.Other, 0, 0, false, false, true);
    const outcome = rule.evaluate(
      [critical, feedback, shown, normal],
      makeContext(
        makeSettings({
          transientExpireEnabled: true,
          transientExpireSeconds: 10,
          transientDndOnly: true,
        }),
        60_000,
        3,
        true,
      ),
    );
    expect(outcome.destroy).toEqual([normal]);
  });
});

describe("RetentionRule", () => {
  const rule = new RetentionRule();

  it("is inert when both limits are zero or guard is off", () => {
    const old = new FakeHandle(1, SourceKey.Other, 0, 0, false, false, false);
    expect(
      rule.evaluate(
        [old],
        makeContext(makeSettings({ globalExpireMinutes: 0, globalMaxCount: 0 }), 3_600_000),
      ).destroy,
    ).toEqual([]);
    expect(
      rule.evaluate(
        [old],
        makeContext(
          makeSettings({ guardEnabled: false, globalExpireMinutes: 5, globalMaxCount: 1 }),
          3_600_000,
        ),
      ).destroy,
    ).toEqual([]);
  });

  it("expires notifications across all sources older than global-expire-minutes", () => {
    const oldOther = new FakeHandle(1, SourceKey.Other, 60_000, 0, false, false, false);
    const oldShot = new FakeHandle(2, SourceKey.Screenshot, 120_000, 0, false, false, true);
    const freshOther = new FakeHandle(3, SourceKey.Other, 500_000, 0, false, false, false);
    const outcome = rule.evaluate(
      [oldOther, oldShot, freshOther],
      makeContext(makeSettings({ globalExpireMinutes: 5 }), 600_000),
    );
    expect(outcome.destroy.map((h) => h.id)).toEqual([1, 2]);
  });

  it("caps total notifications across all sources by oldest first", () => {
    const handles = [
      new FakeHandle(1, SourceKey.Other, 10, 0, false, false, false),
      new FakeHandle(2, SourceKey.Screenshot, 20, 0, false, false, true),
      new FakeHandle(3, SourceKey.Other, 30, 0, false, false, false),
      new FakeHandle(4, SourceKey.Other, 40, 0, false, false, false),
    ];
    const outcome = rule.evaluate(handles, makeContext(makeSettings({ globalMaxCount: 2 })));
    expect(outcome.destroy.map((h) => h.id)).toEqual([1, 2]);
  });

  it("combines age expiry and count cap without over-pruning or duplicates", () => {
    const expired = new FakeHandle(1, SourceKey.Other, 60_000, 0, false, false, false);
    const fresh1 = new FakeHandle(2, SourceKey.Other, 500_000, 0, false, false, false);
    const fresh2 = new FakeHandle(3, SourceKey.Other, 550_000, 0, false, false, false);
    const outcome = rule.evaluate(
      [expired, fresh1, fresh2],
      makeContext(makeSettings({ globalExpireMinutes: 5, globalMaxCount: 2 }), 600_000),
    );
    expect(outcome.destroy.map((h) => h.id)).toEqual([1]);
  });

  it("never destroys critical, feedback, or currently shown notifications", () => {
    const critical = new FakeHandle(1, SourceKey.Other, 0, 0, true, false, false);
    const feedback = new FakeHandle(2, SourceKey.Other, 0, 0, false, true, false);
    const shown = new FakeHandle(3, SourceKey.Other, 0, 0, false, false, false);
    const normal = new FakeHandle(4, SourceKey.Other, 0, 0, false, false, false);
    const outcome = rule.evaluate(
      [critical, feedback, shown, normal],
      makeContext(makeSettings({ globalExpireMinutes: 1, globalMaxCount: 1 }), 600_000, 3),
    );
    expect(outcome.destroy).toEqual([normal]);
  });
});
