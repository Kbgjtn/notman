import { afterEach, describe, expect, it, vi } from "vitest";

import { log } from "../src/log.js";

afterEach(() => {
  vi.unstubAllGlobals();
  log.setDebugEnabled(false);
});

describe("log", () => {
  it("formats info and warn as <level>(<scope>): <message>", () => {
    const output = vi.fn();
    vi.stubGlobal("log", output);

    log.info("engine", "started");
    log.warn("settings", "using default");

    expect(output.mock.calls.map((call) => call[0])).toEqual([
      "info(engine): started",
      "warn(settings): using default",
    ]);
  });

  it("gates debug output behind setDebugEnabled", () => {
    const output = vi.fn();
    vi.stubGlobal("log", output);

    log.debug("bridge", "hidden");
    expect(output).not.toHaveBeenCalled();

    log.setDebugEnabled(true);
    log.debug("bridge", "visible");
    expect(output).toHaveBeenCalledWith("debug(bridge): visible");
  });

  it("passes errors and the formatted line to logError", () => {
    const logError = vi.fn();
    vi.stubGlobal("logError", logError);
    const error = new Error("boom");

    log.err("scheduler", "sweep failed", error);

    expect(logError).toHaveBeenCalledOnce();
    const [wrapped, message] = logError.mock.calls[0];
    expect(wrapped).toBe(error);
    expect(message).toBe("err(scheduler): sweep failed | boom");
  });

  it("falls back to plain log when logError is unavailable", () => {
    const output = vi.fn();
    vi.stubGlobal("log", output);
    vi.stubGlobal("logError", undefined);

    log.err("engine", "destroy failed", "plain reason");

    expect(output).toHaveBeenCalledWith("err(engine): destroy failed | plain reason");
  });

  it("never throws when logging globals are missing", () => {
    vi.stubGlobal("log", undefined);
    vi.stubGlobal("logError", undefined);
    expect(() => log.info("engine", "quiet")).not.toThrow();
    expect(() => log.err("engine", "quiet", new Error("x"))).not.toThrow();
  });
});
