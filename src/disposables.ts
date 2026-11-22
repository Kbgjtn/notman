import { logErr } from "./log.js";

/** Owns teardown callbacks and disposes them in reverse order. */
export class Disposables {
  private readonly _items: Array<() => void> = [];

  add(dispose: () => void): void {
    this._items.push(dispose);
  }

  get size(): number {
    return this._items.length;
  }

  dispose(): void {
    while (this._items.length > 0) {
      const dispose = this._items.pop();
      if (!dispose) continue;
      try {
        dispose();
      } catch (e) {
        logErr(e, "notman: error during teardown");
      }
    }
  }
}
