import { describe, expect, it } from "vitest";

import { CapRule } from "../src/rules/cap.js";
import { ScreenshotRule } from "../src/rules/screenshot.js";
import { FakeHandle, makeContext, makeSettings } from "./fakes.js";

const MiB = 1024 * 1024;

describe("ScreenshotRule", () => {
  const rule = new ScreenshotRule();

  it("handles an empty list", () => {
    const outcome = rule.evaluate([], makeContext(makeSettings()));
    expect(outcome.destroy).toEqual([]);
    expect(outcome.downgrade).toEqual([]);
  });

  it("does nothing when the guard is off", () => {
    const handles = [new FakeHandle(1, "screenshot", 0, MiB)];
    const outcome = rule.evaluate(handles, makeContext(makeSettings({ guardEnabled: false })));
    expect(outcome.destroy).toEqual([]);
    expect(outcome.downgrade).toEqual([]);
  });

  it("is inert when every numeric limit is zero", () => {
    const handles = [new FakeHandle(1, "screenshot", 0, MiB)];
    const outcome = rule.evaluate(
      handles,
      makeContext(makeSettings({ maxCount: 0, expireSeconds: 0, memoryBudgetMb: 0 })),
    );
    expect(outcome.destroy).toEqual([]);
  });

  it("destroys every screenshot notification when notifications are off", () => {
    const shot = new FakeHandle(1, "screenshot", 0);
    const other = new FakeHandle(2, "other", 0);
    const outcome = rule.evaluate(
      [shot, other],
      makeContext(makeSettings({ notifyEnabled: false })),
    );
    expect(outcome.destroy).toEqual([shot]);
  });

  it("ignores non-screenshot sources entirely", () => {
    const other = new FakeHandle(1, "other", 0, MiB);
    const outcome = rule.evaluate(
      [other],
      makeContext(makeSettings({ notifyEnabled: false, thumbnailMode: "text-only" })),
    );
    expect(outcome.destroy).toEqual([]);
    expect(outcome.downgrade).toEqual([]);
  });

  it("downgrades thumbnails in text-only mode", () => {
    const shot = new FakeHandle(1, "screenshot", 0);
    const outcome = rule.evaluate(
      [shot],
      makeContext(makeSettings({ thumbnailMode: "text-only" })),
    );
    expect(outcome.downgrade).toEqual([shot]);
  });

  it("does not re-downgrade an already downgraded handle", () => {
    const shot = new FakeHandle(1, "screenshot", 0);
    shot.downgrade();
    const outcome = rule.evaluate(
      [shot],
      makeContext(makeSettings({ thumbnailMode: "text-only" })),
    );
    expect(outcome.downgrade).toEqual([]);
  });

  it("destroys oldest notifications beyond max-count", () => {
    const handles = [
      new FakeHandle(1, "screenshot", 10),
      new FakeHandle(2, "screenshot", 20),
      new FakeHandle(3, "screenshot", 30),
      new FakeHandle(4, "screenshot", 40),
    ];
    const outcome = rule.evaluate(handles, makeContext(makeSettings({ maxCount: 2 })));
    expect(outcome.destroy.map((h) => h.id)).toEqual([1, 2]);
  });

  it("keeps exactly one notification when max-count is one", () => {
    const handles = [new FakeHandle(1, "screenshot", 10), new FakeHandle(2, "screenshot", 20)];
    const outcome = rule.evaluate(handles, makeContext(makeSettings({ maxCount: 1 })));
    expect(outcome.destroy.map((h) => h.id)).toEqual([1]);
  });

  it("destroys notifications older than the expiry window", () => {
    const old = new FakeHandle(1, "screenshot", 1000);
    const fresh = new FakeHandle(2, "screenshot", 19_000);
    const outcome = rule.evaluate(
      [old, fresh],
      makeContext(makeSettings({ expireSeconds: 10 }), 20_000),
    );
    expect(outcome.destroy).toEqual([old]);
  });

  it("prunes oldest until the memory budget is met", () => {
    const handles = [
      new FakeHandle(1, "screenshot", 10, 600 * 1024),
      new FakeHandle(2, "screenshot", 20, 600 * 1024),
      new FakeHandle(3, "screenshot", 30, 600 * 1024),
    ];
    const outcome = rule.evaluate(handles, makeContext(makeSettings({ memoryBudgetMb: 1 })));
    expect(outcome.destroy.map((h) => h.id)).toEqual([1, 2]);
  });

  it("does not prune when thumbnail sizes are unknown", () => {
    const handles = [1, 2, 3].map((id) => new FakeHandle(id, "screenshot", id, 0));
    const outcome = rule.evaluate(handles, makeContext(makeSettings({ memoryBudgetMb: 1 })));
    expect(outcome.destroy).toEqual([]);
  });

  it("does not return the same handle twice when rules overlap", () => {
    const old = new FakeHandle(1, "screenshot", 1000, MiB);
    const fresh = new FakeHandle(2, "screenshot", 19_000, MiB);
    const outcome = rule.evaluate(
      [old, fresh],
      makeContext(makeSettings({ expireSeconds: 10, maxCount: 1, memoryBudgetMb: 1 }), 20_000),
    );
    expect(outcome.destroy).toEqual([old]);
  });

  it("keeps critical, feedback and currently shown notifications", () => {
    const critical = new FakeHandle(1, "screenshot", 10, 0, true);
    const feedback = new FakeHandle(2, "screenshot", 20, 0, false, true);
    const shown = new FakeHandle(3, "screenshot", 30);
    const normal = new FakeHandle(4, "screenshot", 40);
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
    const handles = [1, 2, 3, 4, 5].map((id) => new FakeHandle(id, "screenshot", id));
    const outcome = rule.evaluate(handles, makeContext(makeSettings({ emergencyHardCap: 2 })));
    expect(outcome.destroy.map((h) => h.id)).toEqual([1, 2, 3]);
  });

  it("is inert when the cap is zero, the guard is off, or nothing exceeds it", () => {
    const handles = [new FakeHandle(1, "screenshot", 1)];
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
    const critical = new FakeHandle(1, "screenshot", 1, 0, true);
    const feedback = new FakeHandle(2, "screenshot", 2, 0, false, true);
    const shown = new FakeHandle(3, "screenshot", 3);
    const outcome = rule.evaluate(
      [critical, feedback, shown],
      makeContext(makeSettings({ emergencyHardCap: 1 }), 1_000_000, 3),
    );
    expect(outcome.destroy).toEqual([]);
  });
});
