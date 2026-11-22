import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as MessageTray from "resource:///org/gnome/shell/ui/messageTray.js";

import type { AdapterCapabilities, ShellAdapter } from "./adapter.js";

const SCREENSHOT_ICON = "screenshot-recorded-symbolic";

/** All shell-version-specific knowledge for GNOME 46 lives here. */
export class V46Adapter implements ShellAdapter {
  readonly id = "v46";
  readonly version = "46";
  readonly signals = {
    sourceAdded: "source-added",
    notificationAdded: "notification-added",
    destroy: "destroy",
  };

  criticalUrgency(): number {
    return MessageTray.Urgency.CRITICAL;
  }

  dismissedReason(): number {
    return MessageTray.NotificationDestroyedReason.DISMISSED;
  }

  getActiveNotifications(): unknown[] {
    const tray = Main.messageTray as unknown as {
      _notification?: unknown;
      _notificationQueue?: unknown[];
    } | null;
    const active = [...(tray?._notificationQueue ?? [])];
    if (tray?._notification) active.push(tray._notification);
    return active;
  }

  probe(): AdapterCapabilities {
    const tray = Main.messageTray as unknown as {
      getSources?: unknown;
      connect?: unknown;
    } | null;
    const panel = (
      Main.panel as unknown as {
        statusArea?: { dateMenu?: { _messageList?: unknown } };
      } | null
    )?.statusArea?.dateMenu?._messageList;
    return {
      tray: !!tray && typeof tray.getSources === "function" && typeof tray.connect === "function",
      panel: !!panel,
      dbus: true,
    };
  }

  isScreenshotSource(source: unknown): boolean {
    if (!source || typeof source !== "object") return false;
    const candidate = source as { iconName?: unknown; title?: unknown };
    if (candidate.iconName === SCREENSHOT_ICON) return true;
    return candidate.title === "Screenshot";
  }
}
