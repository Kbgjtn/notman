enum LogLevel {
  Debug = "debug",
  Info = "info",
  Warn = "warn",
  Error = "err",
}

let debugEnabled = false;

function format(level: LogLevel, scope: string, message: string): string {
  return `${level}(${scope}): ${message}`;
}

/** Minimal Zig-style logger backed by standard console.* (GNOME 45+ EGO compliant). */
export const log = {
  setDebugEnabled(enabled: boolean): void {
    debugEnabled = enabled;
  },

  debug(scope: string, message: string): void {
    if (!debugEnabled) return;
    try {
      console.debug(format(LogLevel.Debug, scope, message));
    } catch {
      // Logging must never mask the original failure.
    }
  },

  info(scope: string, message: string): void {
    try {
      console.log(format(LogLevel.Info, scope, message));
    } catch {
      // Logging must never mask the original failure.
    }
  },

  warn(scope: string, message: string): void {
    try {
      console.warn(format(LogLevel.Warn, scope, message));
    } catch {
      // Logging must never mask the original failure.
    }
  },

  err(scope: string, message: string, error?: unknown): void {
    const detail = error instanceof Error ? error.message : String(error ?? "");
    const line = format(LogLevel.Error, scope, `${message}${detail ? ` | ${detail}` : ""}`);
    try {
      if (error instanceof Error) {
        console.error(error, line);
      } else {
        console.error(line);
      }
    } catch {
      // Logging must never mask the original failure.
    }
  },
};
