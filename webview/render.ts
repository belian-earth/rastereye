/// Shared pixel rendering — used by both tiled (buildTexture) and strip (renderStripImage) paths.

import { getColormapLUT } from "./colormaps";
import {
  state, nodataValue, scalingActive, bandScales, bandOffsets, bandCount,
} from "./state";

/** Render interleaved multi-band data to RGBA Uint8Array.
 *  `data` is interleaved: [p0b0, p0b1, ..., p1b0, p1b1, ...] with `spp` bands per pixel.
 */
export function renderInterleavedToRGBA(
  data: ArrayLike<number>,
  w: number,
  h: number,
  spp: number
): Uint8Array {
  const pixelCount = w * h;
  const nodata = nodataValue;
  const scaled = scalingActive;
  const vMin = state.valueMin;
  const vMax = state.valueMax;
  const range = vMax - vMin || 1;
  const out = new Uint8Array(pixelCount * 4);

  if (state.renderMode === "singleband") {
    const bi = Math.min(state.singleBand, spp - 1);
    const bScale = scaled ? (bandScales[bi] ?? 1) : 1;
    const bOffset = scaled ? (bandOffsets[bi] ?? 0) : 0;
    const lut = getColormapLUT(state.colormap);

    for (let i = 0; i < pixelCount; i++) {
      const dn = data[i * spp + bi];
      if (dn === nodata || dn !== dn) { out[i * 4 + 3] = 0; continue; }
      const frac = ((dn * bScale + bOffset - vMin) / range) * 255;
      const n = frac < 0 ? 0 : frac > 255 ? 255 : (frac + 0.5) | 0;
      out[i * 4] = lut[n * 4];
      out[i * 4 + 1] = lut[n * 4 + 1];
      out[i * 4 + 2] = lut[n * 4 + 2];
      out[i * 4 + 3] = 255;
    }
  } else {
    const ri = Math.min(state.bandR, spp - 1);
    const gi = Math.min(state.bandG, spp - 1);
    const bi = Math.min(state.bandB, spp - 1);
    const sR = scaled ? (bandScales[ri] ?? 1) : 1;
    const oR = scaled ? (bandOffsets[ri] ?? 0) : 0;
    const sG = scaled ? (bandScales[gi] ?? 1) : 1;
    const oG = scaled ? (bandOffsets[gi] ?? 0) : 0;
    const sB = scaled ? (bandScales[bi] ?? 1) : 1;
    const oB = scaled ? (bandOffsets[bi] ?? 0) : 0;

    for (let i = 0; i < pixelCount; i++) {
      const dnR = data[i * spp + ri];
      if (dnR === nodata || dnR !== dnR) { out[i * 4 + 3] = 0; continue; }
      const vr = ((dnR * sR + oR - vMin) / range) * 255;
      const vg = ((data[i * spp + gi] * sG + oG - vMin) / range) * 255;
      const vb = ((data[i * spp + bi] * sB + oB - vMin) / range) * 255;
      out[i * 4] = vr < 0 ? 0 : vr > 255 ? 255 : (vr + 0.5) | 0;
      out[i * 4 + 1] = vg < 0 ? 0 : vg > 255 ? 255 : (vg + 0.5) | 0;
      out[i * 4 + 2] = vb < 0 ? 0 : vb > 255 ? 255 : (vb + 0.5) | 0;
      out[i * 4 + 3] = 255;
    }
  }

  return out;
}

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

    for (let i = 0; i < w * h; i++) {
      const dn = band[i];
      if (dn === nodata || dn !== dn) { rgba[i * 4 + 3] = 0; continue; }
      const frac = ((dn * bScale + bOffset - vMin) / range) * 255;
      const n = frac < 0 ? 0 : frac > 255 ? 255 : (frac + 0.5) | 0;
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
