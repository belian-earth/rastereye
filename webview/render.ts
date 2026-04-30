/// Pixel rendering for the strip-layout fallback path. Tiled rendering goes
/// through the GPU pipeline in gpu-pipeline.ts and doesn't call into here.

import { getColormapLUT } from "./colormaps";
import {
  state, nodataValue, scalingActive, bandScales, bandOffsets, bandCount,
} from "./state";

/** Render per-band arrays to RGBA Uint8ClampedArray (strip fallback path). */
export function renderBandsToRGBA(
  bands: ArrayLike<number>[],
  w: number,
  h: number
): Uint8ClampedArray {
  const nodata = nodataValue;
  const scaled = scalingActive;
  const vMin = state.valueMin;
  const vMax = state.valueMax;
  const range = vMax - vMin || 1;
  const rgba = new Uint8ClampedArray(w * h * 4);
  const bc = bandCount;

  if (state.renderMode === "singleband") {
    const bi = Math.min(state.singleBand, bc - 1);
    const band = bands[bi];
    const bScale = scaled ? (bandScales[bi] ?? 1) : 1;
    const bOffset = scaled ? (bandOffsets[bi] ?? 0) : 0;
    const lut = getColormapLUT(state.colormap);
    const reversed = state.colormapReversed;

    for (let i = 0; i < w * h; i++) {
      const dn = band[i];
      if (dn === nodata || dn !== dn) { rgba[i * 4 + 3] = 0; continue; }
      const frac = ((dn * bScale + bOffset - vMin) / range) * 255;
      let n = frac < 0 ? 0 : frac > 255 ? 255 : (frac + 0.5) | 0;
      if (reversed) n = 255 - n;
      rgba[i * 4] = lut[n * 4];
      rgba[i * 4 + 1] = lut[n * 4 + 1];
      rgba[i * 4 + 2] = lut[n * 4 + 2];
      rgba[i * 4 + 3] = 255;
    }
  } else {
    const ri = Math.min(state.bandR, bc - 1);
    const gi = Math.min(state.bandG, bc - 1);
    const bi = Math.min(state.bandB, bc - 1);
    const bandR = bands[ri];
    const bandG = bands[gi];
    const bandB = bands[bi];
    const sR = scaled ? (bandScales[ri] ?? 1) : 1;
    const oR = scaled ? (bandOffsets[ri] ?? 0) : 0;
    const sG = scaled ? (bandScales[gi] ?? 1) : 1;
    const oG = scaled ? (bandOffsets[gi] ?? 0) : 0;
    const sB = scaled ? (bandScales[bi] ?? 1) : 1;
    const oB = scaled ? (bandOffsets[bi] ?? 0) : 0;

    for (let i = 0; i < w * h; i++) {
      const dnR = bandR[i];
      if (dnR === nodata || dnR !== dnR) { rgba[i * 4 + 3] = 0; continue; }
      const vr = ((dnR * sR + oR - vMin) / range) * 255;
      const vg = ((bandG[i] * sG + oG - vMin) / range) * 255;
      const vb = ((bandB[i] * sB + oB - vMin) / range) * 255;
      rgba[i * 4] = vr < 0 ? 0 : vr > 255 ? 255 : (vr + 0.5) | 0;
      rgba[i * 4 + 1] = vg < 0 ? 0 : vg > 255 ? 255 : (vg + 0.5) | 0;
      rgba[i * 4 + 2] = vb < 0 ? 0 : vb > 255 ? 255 : (vb + 0.5) | 0;
      rgba[i * 4 + 3] = 255;
    }
  }

  return rgba;
}
