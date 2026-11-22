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
    // _notification is the displayed banner; the queue holds the next ones.
    const active: unknown[] = [];
    if (tray?._notification) active.push(tray._notification);
    active.push(...(tray?._notificationQueue ?? []));
    return active;
  }

  getDateMenuMenu(): unknown {
    return (
      (
        Main.panel as unknown as {
          statusArea?: { dateMenu?: { menu?: unknown } };
        } | null
      )?.statusArea?.dateMenu?.menu ?? null
    );
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
    };
  }

  isScreenshotSource(source: unknown): boolean {
    if (!source || typeof source !== "object") return false;
    // The icon is stable and locale-independent. The old title fallback also
    // matched screencast notifications, which share the title "Screenshot".
    return (source as { iconName?: unknown }).iconName === SCREENSHOT_ICON;
  }
}
