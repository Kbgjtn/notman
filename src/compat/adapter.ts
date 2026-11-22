import * as Config from "resource:///org/gnome/shell/misc/config.js";

import { V46Adapter } from "./v46.js";

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
}

/** Detects the matching adapter from the running GNOME Shell version. */
export function detectAdapter(shellVersion: string = Config.PACKAGE_VERSION): ShellAdapter | null {
  const major = shellVersion.split(".")[0];
  if (major === "46") return new V46Adapter();
  return null;
}
