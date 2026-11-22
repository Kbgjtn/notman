type LogErrorFn = (error: unknown, message?: string) => void;
type LogFn = (message: string) => void;

enum LogLevel {
  Debug = "debug",
  Info = "info",
  Warn = "warn",
  Error = "err",
}

const globals = globalThis as { log?: LogFn; logError?: LogErrorFn };
let debugEnabled = false;

function emit(level: LogLevel, scope: string, message: string): void {
  try {
    globals.log?.(`${level}(${scope}): ${message}`);
  } catch {
    // Logging must never mask the original failure.
  }
}

/** Minimal Zig-style logger: <level>(<scope>): <message>. */
export const log = {
  setDebugEnabled(enabled: boolean): void {
    debugEnabled = enabled;
  },

  debug(scope: string, message: string): void {
    if (debugEnabled) emit(LogLevel.Debug, scope, message);
  },

  info(scope: string, message: string): void {
    emit(LogLevel.Info, scope, message);
  },

  warn(scope: string, message: string): void {
    emit(LogLevel.Warn, scope, message);
  },

  err(scope: string, message: string, error?: unknown): void {
    const detail = error instanceof Error ? error.message : String(error ?? "");
    const line = `${LogLevel.Error}(${scope}): ${message}${detail ? ` | ${detail}` : ""}`;
    try {
      if (globals.logError) {
        globals.logError(error instanceof Error ? error : new Error(detail || message), line);
        return;
      }
    } catch {
      // Fall through to plain logging.
    }
    emit(LogLevel.Error, scope, `${message}${detail ? ` | ${detail}` : ""}`);
  },
};
