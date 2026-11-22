import type { NotificationHandle } from "./types.js";

export interface StatsSnapshot {
  activeCount: number;
  estimatedBytes: number;
  peakBytes: number;
  prunedCount: number;
  shellRssBytes: number;
  adapterId: string;
  tier: number;
}

export class Stats {
  private _estimatedBytes = 0;
  private _peakBytes = 0;
  private _prunedCount = 0;
  private _shellRssBytes = 0;
  private _activeCount = 0;

  constructor(
    private readonly _adapterId: string,
    private readonly _tier: number,
  ) {}

  update(handles: NotificationHandle[]): void {
    this._activeCount = handles.length;
    this._estimatedBytes = handles.reduce((sum, handle) => sum + handle.estimatedBytes, 0);
    if (this._estimatedBytes > this._peakBytes) this._peakBytes = this._estimatedBytes;
  }

  pruned(count = 1): void {
    this._prunedCount += count;
  }

  setRss(bytes: number): void {
    this._shellRssBytes = bytes;
  }

  snapshot(): StatsSnapshot {
    return {
      activeCount: this._activeCount,
      estimatedBytes: this._estimatedBytes,
      peakBytes: this._peakBytes,
      prunedCount: this._prunedCount,
      shellRssBytes: this._shellRssBytes,
      adapterId: this._adapterId,
      tier: this._tier,
    };
  }
}
