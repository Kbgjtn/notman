import { log } from "./log.js";
import type { Scheduler } from "./scheduler.js";

const CHECK_INTERVAL_MS = 60_000;
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export function parseTimeMinutes(value: string): number | null {
  const match = TIME_RE.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function formatTimeMinutes(hours: number, minutes: number): string {
  const safeHours = Number.isFinite(hours) ? hours : 0;
  const safeMinutes = Number.isFinite(minutes) ? minutes : 0;
  const h = Math.min(23, Math.max(0, Math.round(safeHours)));
  const m = Math.min(59, Math.max(0, Math.round(safeMinutes)));
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function isWithinQuietHours(
  nowMinutes: number,
  startMinutes: number,
  endMinutes: number,
): boolean {
  if (startMinutes === endMinutes) return false;
  if (startMinutes < endMinutes) {
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  }
  return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}

export interface QuietHoursConfig {
  readonly enabled: boolean;
  readonly start: string;
  readonly end: string;
}

export interface BannerController {
  getShowBanners(): boolean;
  setShowBanners(show: boolean): void;
}

/** Periodically toggles GNOME Do Not Disturb during the configured quiet window. */
export class QuietHoursController {
  private _timerId: number | null = null;
  private _activatedBySchedule: boolean;

  constructor(
    private readonly _readConfig: () => QuietHoursConfig,
    private readonly _banners: BannerController,
    private readonly _scheduler: Scheduler,
    private readonly _nowMinutes: () => number = () => {
      const now = new Date();
      return now.getHours() * 60 + now.getMinutes();
    },
    initialActivated = false,
  ) {
    this._activatedBySchedule = initialActivated;
  }

  get isActivatedBySchedule(): boolean {
    return this._activatedBySchedule;
  }

  start(): void {
    this.sync();
    if (this._timerId === null) {
      this._timerId = this._scheduler.every(CHECK_INTERVAL_MS, () => this.sync());
    }
  }

  sync(): void {
    try {
      const cfg = this._readConfig();
      if (!cfg.enabled) {
        this.restoreIfManaged();
        return;
      }
      const start = parseTimeMinutes(cfg.start);
      const end = parseTimeMinutes(cfg.end);
      if (start === null || end === null) {
        this.restoreIfManaged();
        return;
      }

      const inWindow = isWithinQuietHours(this._nowMinutes(), start, end);
      if (inWindow) {
        if (!this._activatedBySchedule && this._banners.getShowBanners()) {
          this._banners.setShowBanners(false);
          this._activatedBySchedule = true;
          log.info("quiet-hours", `DND enabled (${cfg.start}–${cfg.end})`);
        }
      } else {
        this.restoreIfManaged();
      }
    } catch (e) {
      log.err("quiet-hours", "sync failed", e);
    }
  }

  stop(restore = true): void {
    if (this._timerId !== null) {
      this._scheduler.cancel(this._timerId);
      this._timerId = null;
    }
    if (restore) {
      this.restoreIfManaged();
    } else {
      this._activatedBySchedule = false;
    }
  }

  private restoreIfManaged(): void {
    if (!this._activatedBySchedule) return;
    this._activatedBySchedule = false;
    try {
      this._banners.setShowBanners(true);
      log.info("quiet-hours", "DND restored after quiet hours");
    } catch (e) {
      log.err("quiet-hours", "could not restore show-banners", e);
    }
  }
}
