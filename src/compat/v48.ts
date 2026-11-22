import { GnomeShellAdapter } from "./base.js";

type V48ImageContent = {
  set_bytes(
    coglContext: unknown,
    data: unknown,
    pixelFormat: number,
    width: number,
    height: number,
    rowstride: number,
  ): boolean;
};

type StageWithContext = {
  context?: {
    get_backend?: () => { get_cogl_context?: () => unknown };
  };
};

/** GNOME Shell 48 adapter (handles St.ImageContent.set_bytes Cogl.Context parameter). */
export class V48Adapter extends GnomeShellAdapter {
  readonly id: string = "v48";
  readonly version: string = "48";

  override setImageContentBytes(
    content: unknown,
    data: unknown,
    pixelFormat: number,
    width: number,
    height: number,
    rowstride: number,
  ): boolean {
    const stage = (global as unknown as { stage?: StageWithContext }).stage;
    const coglContext = stage?.context?.get_backend?.()?.get_cogl_context?.();
    if (!coglContext) return false;
    return (content as V48ImageContent).set_bytes(
      coglContext,
      data,
      pixelFormat,
      width,
      height,
      rowstride,
    );
  }
}
