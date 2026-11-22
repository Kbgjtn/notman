import { V48Adapter } from "./v48.js";

/** GNOME Shell 49 adapter: inherits the GNOME 48 Cogl-context set_bytes signature. */
export class V49Adapter extends V48Adapter {
  readonly id: string = "v49";
  readonly version: string = "49";
  readonly mergedCaptureSource: boolean = true;
}
