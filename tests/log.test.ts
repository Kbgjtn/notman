import { afterEach, describe, expect, it, vi } from "vitest";

import { logErr } from "../src/log.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("logErr", () => {
  it("passes Error objects through with their context message", () => {
    const logError = vi.fn();
    vi.stubGlobal("logError", logError);
    const error = new Error("boom");

    logErr(error, "notman: context");

    expect(logError).toHaveBeenCalledWith(error, "notman: context");
  });

  it("wraps non-Error values without throwing", () => {
    const logError = vi.fn();
    vi.stubGlobal("logError", logError);

    logErr("plain failure", "notman: context");

    expect(logError).toHaveBeenCalledOnce();
    const [wrapped, message] = logError.mock.calls[0];
    expect(wrapped).toBeInstanceOf(Error);
    expect((wrapped as Error).message).toBe("plain failure");
    expect(message).toBe("notman: context");
  });

  it("does not panic if the logging global is missing", () => {
    vi.stubGlobal("logError", undefined);
    expect(() => logErr(new Error("x"), "ctx")).not.toThrow();
  });
});
