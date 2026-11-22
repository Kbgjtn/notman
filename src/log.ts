/** Normalises unknown values before handing them to GJS's logError. */
export function logErr(error: unknown, message: string): void {
  const value = error instanceof Error ? error : new Error(String(error));
  logError(value, message);
}
