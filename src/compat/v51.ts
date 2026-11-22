import { V48Adapter } from "./v48.js";

/** GNOME Shell 51 adapter: inherits the GNOME 48 Cogl-context set_bytes signature. */
export class V51Adapter extends V48Adapter {
  readonly id: string = "v51";
  readonly version: string = "51";
  readonly mergedCaptureSource: boolean = true;
}
