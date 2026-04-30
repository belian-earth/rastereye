/// Percentile computation for auto-stretch.

import {
  state, geotiffObj, bandCount, nodataValue, scalingActive,
} from "./state";
import { isNodata, dnToScaled } from "./helpers";
import { setRange } from "./range";
import { stripBands } from "./strip";
import { getDecoderPool } from "./tiled";

let cachedTileData: any = null;

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
      if (!cachedTileData && geotiffObj) {
        const tile = await geotiffObj.fetchTile(0, 0, { pool: getDecoderPool() });
        cachedTileData = tile.array.data;
      }
      if (!cachedTileData) return;
      const pixelCount = cachedTileData.length / bandCount;
      for (let i = 0; i < pixelCount; i++) {
        const dn = cachedTileData[i * bandCount + bi];
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
