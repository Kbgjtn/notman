import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as MessageTray from "resource:///org/gnome/shell/ui/messageTray.js";

import type { AdapterCapabilities, ShellAdapter } from "./adapter.js";
import { hasSourceIcon, SCREENCAST_ICON, SCREENSHOT_ICON } from "./source-match.js";

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
    const panel = Main.panel as unknown as {
      addToStatusArea?: unknown;
    } | null;
    const dateMenu = this.getDateMenuMenu() as { connect?: unknown } | null;
    return {
      tray: !!tray && typeof tray.getSources === "function" && typeof tray.connect === "function",
      topBar: !!panel && typeof panel.addToStatusArea === "function",
      dateMenu: !!dateMenu && typeof dateMenu.connect === "function",
    };
  }

  isScreenshotSource(source: unknown): boolean {
    return hasSourceIcon(source, SCREENSHOT_ICON);
  }

  isScreencastSource(source: unknown): boolean {
    return hasSourceIcon(source, SCREENCAST_ICON);
  }
}
