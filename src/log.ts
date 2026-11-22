let debugEnabled = false;

/** Normalises unknown values before handing them to GJS's logError. */
export function logErr(error: unknown, message: string): void {
  const value = error instanceof Error ? error : new Error(String(error));
  try {
    logError(value, message);
  } catch {
    // Logging must never mask the original failure.
  }
}

export function setDebugEnabled(enabled: boolean): void {
  debugEnabled = enabled;
}

/** Verbose diagnostics, enabled only by the debug-logging setting. */
export function debugLog(message: string): void {
  if (debugEnabled) log(`notman: debug: ${message}`);
}
