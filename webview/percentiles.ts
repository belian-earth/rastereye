/// Percentile computation for auto-stretch.

import {
  state, geotiffObj, bandCount, nodataValue, scalingActive,
} from "./state";
import { isNodata, dnToScaled } from "./helpers";
import { setRange } from "./range";
import { stripBands } from "./strip";
import { getDecoderPool } from "./tiled";
import { tilePixels, bandView } from "./extract";

let cachedTileArray: any = null;

export async function computePercentilesForBand(bandIdx: number): Promise<void> {
  if (!geotiffObj && stripBands.length === 0) return;
  try {
    const bi = Math.min(bandIdx, bandCount - 1);
    const nodata = nodataValue;
    const values: number[] = [];

    if (stripBands.length > 0) {
      const band = stripBands[bi];
      for (let i = 0; i < band.length; i++) {
        const dn = band[i];
        if (isNodata(dn, nodata)) continue;
        values.push(scalingActive ? dnToScaled(dn, bi) : dn);
      }
    } else {
      if (!cachedTileArray && geotiffObj) {
        // Sample the coarsest overview when one exists (overviews are listed
        // finest-first): its tile 0,0 spans the whole image, unlike the
        // full-res top-left tile, which may be unrepresentative or all-nodata.
        // boundless: false — GDAL pads edge tiles with zeros (not nodata),
        // which would otherwise skew the stretch.
        const overviews = geotiffObj.overviews ?? [];
        const source = overviews.length > 0
          ? overviews[overviews.length - 1]
          : geotiffObj;
        const tile = await source.fetchTile(0, 0, {
          pool: getDecoderPool(),
          boundless: false,
        });
        cachedTileArray = tile.array;
      }
      if (!cachedTileArray) return;
      const { px, spp } = tilePixels(cachedTileArray);
      const { src, stride, base } = bandView(px, spp, bi);
      const pixelCount = cachedTileArray.width * cachedTileArray.height;
      for (let i = 0; i < pixelCount; i++) {
        const dn = src[base + i * stride];
        if (isNodata(dn, nodata)) continue;
        values.push(scalingActive ? dnToScaled(dn, bi) : dn);
      }
    }
    if (values.length < 10) return;

    values.sort((a, b) => a - b);
    const p2 = values[Math.floor(values.length * 0.02)];
    const p98 = values[Math.floor(values.length * 0.98)];
    setRange(p2, p98);
  } catch (err) {
    console.warn("[RasterEye] Could not compute percentiles:", err);
  }
}
