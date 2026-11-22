import { describe, expect, it } from "vitest";

import { clampInt, MiB, modeToSwitch, switchToMode } from "../src/ui/mappings.js";

describe("mappings", () => {
  it("maps the thumbnail mode to and from a switch", () => {
    expect(modeToSwitch("text-only")).toBe(true);
    expect(modeToSwitch("full")).toBe(false);
    expect(switchToMode(true)).toBe("text-only");
    expect(switchToMode(false)).toBe("full");
  });

  it("clamps integers and rejects invalid input", () => {
    expect(clampInt(9, 0, 5, 3)).toBe(5);
    expect(clampInt(-2, 0, 5, 3)).toBe(0);
    expect(clampInt(2.7, 0, 5, 3)).toBe(3);
    expect(clampInt(NaN, 0, 5, 3)).toBe(3);
  });

  it("exposes MiB as a constant", () => {
    expect(MiB).toBe(1024 * 1024);
  });
});
