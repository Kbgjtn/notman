type LogErrorFn = (error: unknown, message?: string) => void;
type LogFn = (message: string) => void;

const globals = globalThis as { log?: LogFn; logError?: LogErrorFn };
let debugEnabled = false;

function emit(level: string, scope: string, message: string): void {
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
    if (debugEnabled) emit("debug", scope, message);
  },

  info(scope: string, message: string): void {
    emit("info", scope, message);
  },

  warn(scope: string, message: string): void {
    emit("warn", scope, message);
  },

  err(scope: string, message: string, error?: unknown): void {
    const detail = error instanceof Error ? error.message : String(error ?? "");
    const line = `err(${scope}): ${message}${detail ? ` | ${detail}` : ""}`;
    try {
      if (globals.logError) {
        globals.logError(error instanceof Error ? error : new Error(detail || message), line);
        return;
      }
    } catch {
      // Fall through to plain logging.
    }
    emit("err", scope, `${message}${detail ? ` | ${detail}` : ""}`);
  },
};
