import { afterEach, describe, expect, it, vi } from "vitest";

import { Disposables } from "../src/disposables.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Disposables", () => {
  it("disposes callbacks in reverse order", () => {
    const calls: number[] = [];
    const disposables = new Disposables();
    disposables.add(() => calls.push(1));
    disposables.add(() => calls.push(2));
    disposables.add(() => calls.push(3));

    disposables.dispose();

    expect(calls).toEqual([3, 2, 1]);
    expect(disposables.size).toBe(0);
  });

  it("continues after a callback throws and logs the failure", () => {
    const logError = vi.fn();
    vi.stubGlobal("logError", logError);
    const calls: number[] = [];
    const disposables = new Disposables();
    disposables.add(() => calls.push(1));
    disposables.add(() => {
      throw new Error("teardown failed");
    });
    disposables.add(() => calls.push(3));

    expect(() => disposables.dispose()).not.toThrow();

    expect(calls).toEqual([3, 1]);
    expect(logError).toHaveBeenCalledOnce();
    expect(logError.mock.calls[0][1]).toBe("notman: error during teardown");
  });

  it("is safe to dispose an empty registry", () => {
    expect(() => new Disposables().dispose()).not.toThrow();
  });
});
