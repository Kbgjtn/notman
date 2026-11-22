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

  getNotificationControlsRow(): unknown {
    const messageList = (
      Main.panel as unknown as {
        statusArea?: { dateMenu?: { _messageList?: unknown } };
      } | null
    )?.statusArea?.dateMenu?._messageList;
    if (!messageList || typeof messageList !== "object") return null;

    const clearButton = (messageList as { _clearButton?: { get_parent?: () => unknown } })
      ._clearButton;
    if (clearButton && typeof clearButton.get_parent === "function") {
      const row = clearButton.get_parent();
      if (row) return row;
    }

    type Actor = {
      has_style_class_name?: (name: string) => boolean;
      get_children?: () => unknown[];
    };
    const find = (actor: unknown): unknown => {
      if (!actor || typeof actor !== "object") return null;
      const node = actor as Actor;
      if (node.has_style_class_name?.("message-list-controls")) return actor;
      for (const child of node.get_children?.() ?? []) {
        const found = find(child);
        if (found) return found;
      }
      return null;
    };
    return find(messageList);
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
