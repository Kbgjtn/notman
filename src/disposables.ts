import { log } from "./log.js";

/** Owns teardown callbacks and disposes them in reverse order. */
export class Disposables {
  private readonly _items = new Set<() => void>();

  add(dispose: () => void): void {
    this._items.add(dispose);
  }

  remove(dispose: () => void): void {
    this._items.delete(dispose);
  }

  get size(): number {
    return this._items.size;
  }

  dispose(): void {
    const items = [...this._items].reverse();
    this._items.clear();
    for (const dispose of items) {
      try {
        dispose();
      } catch (e) {
        log.err("disposables", "error during teardown", e);
      }
    }
  }
}
