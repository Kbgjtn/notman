import * as Config from "resource:///org/gnome/shell/misc/config.js";

import { V46Adapter } from "./v46.js";
import { V47Adapter } from "./v47.js";
import { V48Adapter } from "./v48.js";
import { V49Adapter } from "./v49.js";
import { V50Adapter } from "./v50.js";
import { V51Adapter } from "./v51.js";
import { resolveAdapterMajor, SupportedMajor } from "./version.js";

export interface AdapterCapabilities {
  tray: boolean;
  topBar: boolean;
  dateMenu: boolean;
}

export interface ShellAdapter {
  readonly id: string;
  readonly version: string;
  /** GNOME 49+ shares one "Screen Capture" source between screenshots and screencasts. */
  readonly mergedCaptureSource: boolean;
  readonly signals: {
    sourceAdded: string;
    notificationAdded: string;
    destroy: string;
  };
  probe(): AdapterCapabilities;
  isScreenshotSource(source: unknown): boolean;
  isScreencastSource(source: unknown): boolean;
  criticalUrgency(): number;
  dismissedReason(): number;
  getActiveNotifications(): unknown[];
  getDateMenuMenu(): unknown;
  setImageContentBytes(
    content: unknown,
    data: unknown,
    pixelFormat: number,
    width: number,
    height: number,
    rowstride: number,
  ): boolean;
}

/** Detects the matching adapter from the running GNOME Shell version. */
export function detectAdapter(shellVersion: string = Config.PACKAGE_VERSION): ShellAdapter | null {
  switch (resolveAdapterMajor(shellVersion)) {
    case SupportedMajor.V46:
      return new V46Adapter();
    case SupportedMajor.V47:
      return new V47Adapter();
    case SupportedMajor.V48:
      return new V48Adapter();
    case SupportedMajor.V49:
      return new V49Adapter();
    case SupportedMajor.V50:
      return new V50Adapter();
    case SupportedMajor.V51:
      return new V51Adapter();
    default:
      return null;
  }
}
