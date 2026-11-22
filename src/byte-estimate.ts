export const KiB = 1024;
export const MiB = 1024 * 1024;

export function formatMiB(bytes: number): string {
  return `${(Math.max(0, bytes) / MiB).toFixed(1)} MiB`;
}

export function formatBytes(bytes: number): string {
  const safe = Math.max(0, bytes);
  if (safe >= MiB) return formatMiB(safe);
  if (safe >= KiB) return `${Math.round(safe / KiB)} KB`;
  return `${Math.round(safe)} B`;
}

/**
 * Estimates RGBA8888 texture bytes from a Clutter/St content icon.
 *
 * Clutter.Content.get_preferred_size() returns [success, width, height]; the
 * simpler [width, height] shape is accepted as a defensive fallback.
 */
export function estimateContentBytes(icon: unknown): number {
  if (!icon || typeof icon !== "object") return 0;
  const sized = icon as { get_preferred_size?: () => unknown };
  if (typeof sized.get_preferred_size !== "function") return 0;

  try {
    const size = sized.get_preferred_size();
    if (!Array.isArray(size)) return 0;

    let width: number;
    let height: number;
    if (typeof size[0] === "boolean") {
      if (!size[0]) return 0;
      width = Number(size[1]);
      height = Number(size[2]);
    } else {
      width = Number(size[0]);
      height = Number(size[1]);
    }

    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0)
      return Math.round(width * height * 4);
  } catch {
    // Unknown implementation: fall back to count-only accounting.
  }
  return 0;
}
