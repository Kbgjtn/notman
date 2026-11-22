import GLib from "gi://GLib";

import { logErr } from "./log.js";
import type { Scheduler } from "./scheduler.js";

export class GlibScheduler implements Scheduler {
  every(intervalMs: number, callback: () => void): number {
    return GLib.timeout_add(GLib.PRIORITY_LOW, intervalMs, () => {
      // An uncaught exception here would crash GNOME Shell itself.
      try {
        callback();
      } catch (e) {
        logErr(e, "notman: scheduled sweep failed");
      }
      return GLib.SOURCE_CONTINUE;
    });
  }

  cancel(id: number): void {
    GLib.source_remove(id);
  }
}
