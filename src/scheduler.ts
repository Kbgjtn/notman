/** Injected so the engine can be unit-tested without GJS/GI modules. */
export interface Scheduler {
  every(intervalMs: number, callback: () => void): number;
  cancel(id: number): void;
}
