import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import type { AdapterCapabilities, ShellAdapter } from './adapter.js';

const SCREENSHOT_ICON = 'screenshot-recorded-symbolic';

/** All shell-version-specific knowledge for GNOME 46 lives here. */
export class V46Adapter implements ShellAdapter {
  readonly id = 'v46';
  readonly version = '46';

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
      tray: !!tray && typeof tray.getSources === 'function' && typeof tray.connect === 'function',
      panel: !!panel,
      dbus: true,
    };
  }

  isScreenshotSource(source: unknown): boolean {
    if (!source || typeof source !== 'object') return false;
    const candidate = source as { iconName?: unknown; title?: unknown };
    if (candidate.iconName === SCREENSHOT_ICON) return true;
    return candidate.title === 'Screenshot';
  }
}
