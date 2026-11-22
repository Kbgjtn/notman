import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { SettingKey } from "../src/settings.js";

const SCHEMA = "schemas/org.gnome.shell.extensions.notman.gschema.xml";

describe("scaffold", () => {
  it("pins the verified GNOME version and UUID", () => {
    const metadata = JSON.parse(readFileSync("metadata.json", "utf8"));
    expect(metadata["shell-version"]).toEqual(["46", "47", "48"]);
    expect(metadata.uuid).toBe("notman@kbgjtn.github.io");
    expect(metadata["settings-schema"]).toBe("org.gnome.shell.extensions.notman");
  });

  it("declares every SettingKey in the GSettings schema", () => {
    const xml = readFileSync(SCHEMA, "utf8");
    for (const key of Object.values(SettingKey)) {
      expect(xml).toContain(`name="${key}"`);
    }
  });

  it("uses the compiled shell resource path for preferences", () => {
    const prefs = readFileSync("prefs.ts", "utf8");
    expect(prefs).toContain("resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js");
    expect(prefs).not.toContain("resource:///org/gnome/shell/extensions/prefs.js");
  });
});
