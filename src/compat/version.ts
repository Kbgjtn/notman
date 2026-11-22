export enum SupportedMajor {
  V46 = "46",
  V47 = "47",
  V48 = "48",
}

/** Resolves a GNOME Shell version string (e.g. "47.2") to a supported major version. */
export function resolveAdapterMajor(shellVersion: string): SupportedMajor | null {
  const major = shellVersion.trim().split(".")[0];
  if (major === SupportedMajor.V46) return SupportedMajor.V46;
  if (major === SupportedMajor.V47) return SupportedMajor.V47;
  if (major === SupportedMajor.V48) return SupportedMajor.V48;
  return null;
}
