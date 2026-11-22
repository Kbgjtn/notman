import { describe, expect, it } from "vitest";

import { MiB } from "../src/byte-estimate.js";
import { CapRule } from "../src/rules/cap.js";
import { ScreenshotRule } from "../src/rules/screenshot.js";
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
});
