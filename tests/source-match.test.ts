import { describe, expect, it } from "vitest";

import {
  hasSourceIcon,
  SCREEN_CAPTURE_ICON,
  SCREENCAST_ICON,
  SCREENSHOT_ICON,
} from "../src/compat/source-match.js";

describe("hasSourceIcon", () => {
  it("matches GNOME 46-48 capture icons", () => {
    expect(hasSourceIcon({ iconName: SCREENSHOT_ICON }, SCREENSHOT_ICON)).toBe(true);
    expect(hasSourceIcon({ iconName: SCREENCAST_ICON }, SCREENCAST_ICON)).toBe(true);
  });

  it("matches the GNOME 49+ shared Screen Capture source", () => {
    expect(hasSourceIcon({ iconName: SCREEN_CAPTURE_ICON }, SCREEN_CAPTURE_ICON)).toBe(true);
    expect(
      hasSourceIcon({ icon: { get_names: () => [SCREEN_CAPTURE_ICON] } }, SCREEN_CAPTURE_ICON),
    ).toBe(true);
  });

  it("does not confuse the shared source with the legacy icons", () => {
    expect(hasSourceIcon({ iconName: SCREEN_CAPTURE_ICON }, SCREENSHOT_ICON)).toBe(false);
    expect(hasSourceIcon({ iconName: SCREENSHOT_ICON }, SCREEN_CAPTURE_ICON)).toBe(false);
  });

  it("handles missing and malformed sources", () => {
    expect(hasSourceIcon(null, SCREEN_CAPTURE_ICON)).toBe(false);
    expect(hasSourceIcon({}, SCREEN_CAPTURE_ICON)).toBe(false);
  });
});
