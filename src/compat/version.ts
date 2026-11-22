export enum SupportedMajor {
  V46 = "46",
  V47 = "47",
  V48 = "48",
  V49 = "49",
  V50 = "50",
  V51 = "51",
}

/** Resolves a GNOME Shell version string (e.g. "47.2") to a supported major version. */
export function resolveAdapterMajor(shellVersion: string): SupportedMajor | null {
  const major = shellVersion.trim().split(".")[0];
  const supported: readonly string[] = Object.values(SupportedMajor);
  return supported.includes(major) ? (major as SupportedMajor) : null;
}
