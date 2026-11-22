export const SCREENSHOT_ICON = "screenshot-recorded-symbolic";
export const SCREENCAST_ICON = "screencast-recorded-symbolic";

/** Matches GNOME MessageTray.Source icon names across iconName and Gio.ThemedIcon. */
export function hasSourceIcon(source: unknown, iconName: string): boolean {
  if (!source || typeof source !== "object") return false;
  // In GNOME 46, MessageTray.Source turns constructor `iconName` into a
  // Gio.ThemedIcon on `source.icon`, leaving `source.iconName` null.
  const candidate = source as {
    iconName?: unknown;
    icon?: { get_names?: () => string[] } | null;
  };
  if (candidate.iconName === iconName) return true;
  if (candidate.icon && typeof candidate.icon.get_names === "function") {
    try {
      return candidate.icon.get_names().includes(iconName);
    } catch {
      return false;
    }
  }
  return false;
}
