import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SCHEMA = "schemas/org.gnome.shell.extensions.notman.gschema.xml";

describe("scaffold", () => {
  it("pins the verified GNOME version and UUID", () => {
    const metadata = JSON.parse(readFileSync("metadata.json", "utf8"));
    expect(metadata["shell-version"]).toEqual(["46"]);
    expect(metadata.uuid).toBe("notman@ozy.local");
    expect(metadata["settings-schema"]).toBe("org.gnome.shell.extensions.notman");
  });

  it("declares every agreed settings key", () => {
    const xml = readFileSync(SCHEMA, "utf8");
    for (const key of [
      "guard-enabled",
      "screenshot-notify-enabled",
      "screenshot-thumbnail-mode",
      "screenshot-max-count",
      "screenshot-expire-seconds",
      "screenshot-memory-budget-mb",
      "emergency-hard-cap",
      "clear-on-panel-open",
      "show-stats",
      "debug-logging",
    ]) {
      expect(xml).toContain(`name="${key}"`);
    }
  });

  it("uses the compiled shell resource path for preferences", () => {
    const prefs = readFileSync("prefs.ts", "utf8");
    expect(prefs).toContain("resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js");
    expect(prefs).not.toContain("resource:///org/gnome/shell/extensions/prefs.js");
  });
});
