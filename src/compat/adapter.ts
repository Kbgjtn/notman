import { V46Adapter } from "./v46.js";

export interface AdapterCapabilities {
  tray: boolean;
  panel: boolean;
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
  criticalUrgency(): number;
  dismissedReason(): number;
  getActiveNotifications(): unknown[];
  getDateMenuMenu(): unknown;
}

/**
 * Version comes from metadata.json, never from a runtime config module:
 * the shell does not expose a stable resource path for its version.
 */
export function detectAdapter(shellVersion: string): ShellAdapter | null {
  const major = shellVersion.split(".")[0];
  if (major === "46") return new V46Adapter();
  return null;
}
