import * as Config from "resource:///org/gnome/shell/misc/config.js";

import { V46Adapter } from "./v46.js";
import { V47Adapter } from "./v47.js";
import { V48Adapter } from "./v48.js";
import { resolveAdapterMajor, SupportedMajor } from "./version.js";

export interface AdapterCapabilities {
  tray: boolean;
  topBar: boolean;
  dateMenu: boolean;
}

export interface ShellAdapter {
  readonly id: string;
  readonly version: string;
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
    default:
      return null;
  }
}
