import { V48Adapter } from "./v48.js";

/** GNOME Shell 50 adapter: inherits the GNOME 48 Cogl-context set_bytes signature. */
export class V50Adapter extends V48Adapter {
  readonly id: string = "v50";
  readonly version: string = "50";
  readonly mergedCaptureSource: boolean = true;
}
