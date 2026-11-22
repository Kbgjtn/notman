import GLib from "gi://GLib";

import { log } from "./log.js";
import type { Scheduler } from "./scheduler.js";

export class GlibScheduler implements Scheduler {
  every(intervalMs: number, callback: () => void): number {
    return GLib.timeout_add(GLib.PRIORITY_LOW, intervalMs, () => {
      // An uncaught exception here would crash GNOME Shell itself.
      try {
        callback();
      } catch (e) {
        log.err("scheduler", "scheduled sweep failed", e);
      }
      return GLib.SOURCE_CONTINUE;
    });
  }

  cancel(id: number): void {
    GLib.source_remove(id);
  }
}
