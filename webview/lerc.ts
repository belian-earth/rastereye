/// LERC decoder setup.
///
/// The decoder is WebAssembly that the `lerc` package normally fetches from a
/// URL next to its script. Here the binary is embedded in the bundle and
/// handed over as a blob URL, so nothing has to be served alongside
/// webview.js. Both GeoTIFF readers import the same `lerc` module, so loading
/// it once covers the tiled and strip paths.

import * as Lerc from "lerc";
import lercWasm from "../node_modules/lerc/lerc-wasm.wasm";

let loading: Promise<void> | null = null;

export function ensureLercLoaded(): Promise<void> {
  if (!loading) {
    const url = URL.createObjectURL(
      new Blob([lercWasm as Uint8Array<ArrayBuffer>], { type: "application/wasm" }),
    );
    loading = Lerc.load({ locateFile: () => url }).finally(() => URL.revokeObjectURL(url));
  }
  return loading;
}
