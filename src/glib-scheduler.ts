import GLib from "gi://GLib";

import type { Scheduler } from "./scheduler.js";

export class GlibScheduler implements Scheduler {
  every(intervalMs: number, callback: () => void): number {
    return GLib.timeout_add(GLib.PRIORITY_LOW, intervalMs, () => {
      callback();
      return GLib.SOURCE_CONTINUE;
    });
  }

  cancel(id: number): void {
    GLib.source_remove(id);
  }
}
