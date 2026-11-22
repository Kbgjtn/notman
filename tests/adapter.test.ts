import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { resolveAdapterMajor, SupportedMajor } from "../src/compat/version.js";

describe("resolveAdapterMajor", () => {
  it("resolves GNOME Shell 46, 47, and 48 versions", () => {
    expect(resolveAdapterMajor("46.0")).toBe(SupportedMajor.V46);
    expect(resolveAdapterMajor("46.4")).toBe(SupportedMajor.V46);
    expect(resolveAdapterMajor("47.0")).toBe(SupportedMajor.V47);
    expect(resolveAdapterMajor("47.3")).toBe(SupportedMajor.V47);
    expect(resolveAdapterMajor("48.0")).toBe(SupportedMajor.V48);
    expect(resolveAdapterMajor("48.1")).toBe(SupportedMajor.V48);
  });

  it("returns null for unsupported or malformed versions", () => {
    expect(resolveAdapterMajor("45.0")).toBeNull();
    expect(resolveAdapterMajor("49.0")).toBeNull();
    expect(resolveAdapterMajor("")).toBeNull();
    expect(resolveAdapterMajor("unknown")).toBeNull();
  });

  it("keeps metadata.json shell-version in sync with supported adapters", () => {
    const metadata = JSON.parse(readFileSync("metadata.json", "utf8")) as {
      "shell-version": string[];
    };
    expect(metadata["shell-version"]).toEqual(Object.values(SupportedMajor));
  });
});
