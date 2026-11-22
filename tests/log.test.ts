import { afterEach, describe, expect, it, vi } from "vitest";

import { log } from "../src/log.js";

afterEach(() => {
  vi.restoreAllMocks();
  log.setDebugEnabled(false);
});

describe("log", () => {
  it("formats info and warn as <level>(<scope>): <message>", () => {
    const infoSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    log.info("engine", "started");
    log.warn("settings", "using default");

    expect(infoSpy).toHaveBeenCalledWith("info(engine): started");
    expect(warnSpy).toHaveBeenCalledWith("warn(settings): using default");
  });

  it("gates debug output behind setDebugEnabled", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

    log.debug("bridge", "hidden");
    expect(debugSpy).not.toHaveBeenCalled();

    log.setDebugEnabled(true);
    log.debug("bridge", "visible");
    expect(debugSpy).toHaveBeenCalledWith("debug(bridge): visible");
  });

  it("passes Error instances and formatted message to console.error", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("boom");

    log.err("scheduler", "sweep failed", error);

    expect(errSpy).toHaveBeenCalledWith(error, "err(scheduler): sweep failed | boom");
  });

  it("formats non-Error details cleanly in console.error", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    log.err("engine", "destroy failed", "plain reason");

    expect(errSpy).toHaveBeenCalledWith("err(engine): destroy failed | plain reason");
  });

  it("never throws when console methods throw", () => {
    vi.spyOn(console, "log").mockImplementation(() => {
      throw new Error("broken");
    });
    vi.spyOn(console, "error").mockImplementation(() => {
      throw new Error("broken");
    });
    expect(() => log.info("engine", "quiet")).not.toThrow();
    expect(() => log.err("engine", "quiet", new Error("x"))).not.toThrow();
  });
});
