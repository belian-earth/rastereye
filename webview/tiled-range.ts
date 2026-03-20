/// Default range computation for tiled files (breaks import cycle between range ↔ percentiles).

import { scalingActive } from "./state";
import { state } from "./state";
import { setRange } from "./range";
import { dnToScaled } from "./helpers";
import { computePercentilesForBand } from "./percentiles";

export function updateDefaultRange(tiff: any): void {
  const bps = tiff.cachedTags?.bitsPerSample?.[0] ?? 8;
  const sf = tiff.cachedTags?.sampleFormat;
  let fallbackMin = 0;
  let fallbackMax = 255;
  if (sf === 3 || sf === "IEEE floating point") {
    fallbackMax = 1;
  } else if (bps <= 16 && bps > 8) {
    fallbackMax =
      sf === 2 || sf === "Twos complement signed integer" ? 32767 : 10000;
  }
  if (scalingActive) {
    fallbackMin = dnToScaled(fallbackMin, 0);
    fallbackMax = dnToScaled(fallbackMax, 0);
    if (fallbackMin > fallbackMax) {
      [fallbackMin, fallbackMax] = [fallbackMax, fallbackMin];
    }
  }
  setRange(fallbackMin, fallbackMax);
  computePercentilesForBand(state.singleBand);
}
