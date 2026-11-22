import { debugLog, logErr } from "./log.js";
import { CapRule } from "./rules/cap.js";
import { ScreenshotRule } from "./rules/screenshot.js";
import type { Scheduler } from "./scheduler.js";
import type { SettingsStore } from "./settings.js";
import type { Bridge } from "./shell-bridge.js";
import { Stats, type StatsSnapshot } from "./stats.js";
import type { NotificationHandle, Rule, RuleContext } from "./types.js";

const SWEEP_INTERVAL_MS = 1000;

export class Engine {
  private readonly _rules: Rule[] = [new ScreenshotRule(), new CapRule()];
  private readonly _handles = new Map<number, NotificationHandle>();
  private readonly _pending = new Set<number>();
  private readonly _stats: Stats;
  private _sweepId: number | null = null;
  private _started = false;

  constructor(
    private readonly _settings: SettingsStore,
    private readonly _bridge: Bridge,
    adapterId: string,
    tier: number,
    private readonly _scheduler: Scheduler,
  ) {
    this._stats = new Stats(adapterId, tier);
  }

  start(): boolean {
    if (this._started) return true;
    const started = this._bridge.start(
      (notification) => this.onNotificationAdded(notification),
      (notification) => this.onNotificationDestroyed(notification),
    );
    if (!started) return false;
    this._started = true;
    this._sweepId = this._scheduler.every(SWEEP_INTERVAL_MS, () => {
      this.sweep();
    });
    return true;
  }

  stop(): void {
    if (this._sweepId !== null) {
      this._scheduler.cancel(this._sweepId);
      this._sweepId = null;
    }
    this._bridge.stop();
    this._handles.clear();
    this._pending.clear();
    this._stats.update([]);
    this._started = false;
  }

  onNotificationAdded(notification: unknown): void {
    const sourceKey = this._bridge.sourceKeyFor(notification);
    debugLog(`notification added sourceKey=${sourceKey}`);
    const handle = this._bridge.makeHandle(notification, sourceKey);
    if (!handle) return;
    this._handles.set(handle.id, handle);
    // Immediate pass: notifyEnabled=false and text-only apply without waiting
    // for the next sweep, so the full-size texture is never retained.
    this.sweep();
  }

  onNotificationDestroyed(notification: unknown): void {
    const id = this._bridge.idFor(notification);
    if (id === null) return;
    this._handles.delete(id);
    this._pending.delete(id);
    this._stats.update([...this._handles.values()]);
  }

  sweep(): void {
    try {
      const context: RuleContext = {
        nowMs: Date.now(),
        settings: this._settings.read(),
        currentlyShownId: this._bridge.currentlyShownId(),
        log: (message) => log(`notman: ${message}`),
      };
      for (const rule of this._rules) {
        // Rules may destroy handles, so each one sees the surviving set.
        const handles = [...this._handles.values()];
        const outcome = rule.evaluate(handles, context);
        debugLog(
          `rule ${rule.id}: tracked=${handles.length} destroy=${outcome.destroy.length} downgrade=${outcome.downgrade.length}`,
        );
        for (const handle of outcome.downgrade) {
          try {
            handle.downgrade();
          } catch (e) {
            logErr(e, `notman: rule ${rule.id} downgrade failed`);
          }
        }
        for (const handle of outcome.destroy) this.destroyHandle(handle);
      }
      this._stats.update([...this._handles.values()]);
    } catch (e) {
      logErr(e, "notman: sweep failed");
    }
  }

  private destroyHandle(handle: NotificationHandle): void {
    if (this._pending.has(handle.id)) return;
    let destroyed = false;
    try {
      destroyed = handle.destroy();
    } catch (e) {
      logErr(e, "notman: destroying notification failed");
    }
    if (!destroyed) return;
    this._pending.add(handle.id);
    this._handles.delete(handle.id);
    this._stats.pruned();
  }

  getStats(): StatsSnapshot {
    this._stats.setRss(this._bridge.readRssBytes());
    return this._stats.snapshot();
  }

  clearScreenshots(): void {
    for (const handle of [...this._handles.values()]) {
      if (handle.sourceKey === "screenshot") this.destroyHandle(handle);
    }
  }

  setEnabled(enabled: boolean): void {
    this._settings.setNotifyEnabled(enabled);
    this.sweep();
  }

  setMaxCount(count: number): void {
    this._settings.setMaxCount(count);
    this.sweep();
  }
}
