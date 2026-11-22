import { describe, expect, it } from "vitest";

import { estimateContentBytes, formatBytes, formatMiB, KiB, MiB } from "../src/byte-estimate.js";

describe("estimateContentBytes", () => {
  it("reads the Clutter.Content triple [success, width, height]", () => {
    const icon = { get_preferred_size: () => [true, 3840, 2160] };
    expect(estimateContentBytes(icon)).toBe(3840 * 2160 * 4);
  });

  it("returns zero when the content reports no preferred size", () => {
    const icon = { get_preferred_size: () => [false, 3840, 2160] };
    expect(estimateContentBytes(icon)).toBe(0);
  });

  it("accepts the simpler [width, height] shape defensively", () => {
    const icon = { get_preferred_size: () => [1920, 1080] };
    expect(estimateContentBytes(icon)).toBe(1920 * 1080 * 4);
  });

  it("returns zero for missing, non-object or malformed icons", () => {
    expect(estimateContentBytes(null)).toBe(0);
    expect(estimateContentBytes(undefined)).toBe(0);
    expect(estimateContentBytes(42)).toBe(0);
    expect(estimateContentBytes({})).toBe(0);
    expect(estimateContentBytes({ get_preferred_size: () => "bad" })).toBe(0);
  });

  it("returns zero for non-finite dimensions and does not throw on failure", () => {
    expect(estimateContentBytes({ get_preferred_size: () => [true, 0, 2160] })).toBe(0);
    expect(estimateContentBytes({ get_preferred_size: () => [true, NaN, 10] })).toBe(0);
    expect(
      estimateContentBytes({
        get_preferred_size: () => {
          throw new Error("broken content");
        },
      }),
    ).toBe(0);
  });

  it("formats bytes in MiB", () => {
    expect(MiB).toBe(1024 * 1024);
    expect(formatMiB(0)).toBe("0.0 MiB");
    expect(formatMiB(2.5 * MiB)).toBe("2.5 MiB");
    expect(formatMiB(-100)).toBe("0.0 MiB");
  });

  it("formats bytes adaptively in B, KB, and MiB", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(-50)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(36 * KiB)).toBe("36 KB");
    expect(formatBytes(40_960)).toBe("40 KB");
    expect(formatBytes(MiB)).toBe("1.0 MiB");
    expect(formatBytes(3.5 * MiB)).toBe("3.5 MiB");
  });
});
