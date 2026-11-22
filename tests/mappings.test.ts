import { describe, expect, it } from "vitest";
import type { StatsSnapshot } from "../src/stats.js";
import {
  BUDGET_STEPS,
  clampInt,
  cycleValue,
  EXPIRE_STEPS,
  formatStats,
  HARD_CAP_STEPS,
  MAX_COUNT_STEPS,
  modeToSwitch,
  switchToMode,
} from "../src/ui/mappings.js";

describe("mappings", () => {
  it("maps the thumbnail mode to and from a switch", () => {
    expect(modeToSwitch("text-only")).toBe(true);
    expect(modeToSwitch("full")).toBe(false);
    expect(switchToMode(true)).toBe("text-only");
    expect(switchToMode(false)).toBe("full");
  });

  it("cycles through each allowed value list", () => {
    expect(cycleValue(0, MAX_COUNT_STEPS)).toBe(1);
    expect(cycleValue(3, MAX_COUNT_STEPS)).toBe(5);
    expect(cycleValue(20, MAX_COUNT_STEPS)).toBe(0);
    expect(cycleValue(999, MAX_COUNT_STEPS)).toBe(0);
    expect(cycleValue(300, EXPIRE_STEPS)).toBe(0);
    expect(cycleValue(64, BUDGET_STEPS)).toBe(128);
    expect(cycleValue(64, HARD_CAP_STEPS)).toBe(0);
  });

  it("handles empty step lists", () => {
    expect(cycleValue(7, [])).toBe(7);
  });

  it("clamps integers and rejects invalid input", () => {
    expect(clampInt(9, 0, 5, 3)).toBe(5);
    expect(clampInt(-2, 0, 5, 3)).toBe(0);
    expect(clampInt(2.7, 0, 5, 3)).toBe(3);
    expect(clampInt(NaN, 0, 5, 3)).toBe(3);
  });

  it("formats stats in a compact readable line", () => {
    const stats: StatsSnapshot = {
      activeCount: 3,
      estimatedBytes: 2 * 1024 * 1024,
      peakBytes: 4 * 1024 * 1024,
      prunedCount: 12,
      shellRssBytes: 0,
      adapterId: "v46",
      tier: 2,
    };
    expect(formatStats(stats)).toBe("3 kept · 2.0 MiB · peak 4.0 MiB · pruned 12");
  });
});
