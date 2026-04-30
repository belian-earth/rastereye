/**
 * Colormap definitions and RGBA lookup table generation.
 * Each colormap is defined as control points [position, r, g, b] with linear interpolation.
 */

type ColorStop = [number, number, number, number]; // [t, r, g, b]

const COLORMAP_DEFS: Record<string, ColorStop[]> = {
  viridis: [
    [0, 68, 1, 84],
    [0.13, 72, 36, 117],
    [0.25, 64, 67, 135],
    [0.38, 52, 95, 141],
    [0.5, 33, 145, 140],
    [0.63, 53, 183, 121],
    [0.75, 109, 206, 89],
    [0.88, 180, 222, 44],
    [1, 253, 231, 37],
  ],
  magma: [
    [0, 0, 0, 4],
    [0.13, 28, 16, 68],
    [0.25, 79, 18, 123],
    [0.38, 129, 37, 129],
    [0.5, 181, 54, 122],
    [0.63, 229, 89, 100],
    [0.75, 251, 135, 97],
    [0.88, 254, 194, 140],
    [1, 252, 253, 191],
  ],
  inferno: [
    [0, 0, 0, 4],
    [0.13, 31, 12, 72],
    [0.25, 85, 15, 109],
    [0.38, 136, 34, 106],
    [0.5, 186, 54, 85],
    [0.63, 227, 89, 51],
    [0.75, 249, 140, 10],
    [0.88, 249, 201, 50],
    [1, 252, 255, 164],
  ],
  plasma: [
    [0, 13, 8, 135],
    [0.13, 75, 3, 161],
    [0.25, 126, 3, 168],
    [0.38, 168, 34, 150],
    [0.5, 203, 70, 121],
    [0.63, 229, 107, 93],
    [0.75, 248, 148, 65],
    [0.88, 253, 195, 40],
    [1, 240, 249, 33],
  ],
  turbo: [
    [0, 48, 18, 59],
    [0.07, 67, 62, 133],
    [0.14, 61, 113, 181],
    [0.21, 39, 158, 207],
    [0.29, 24, 195, 201],
    [0.36, 40, 222, 163],
    [0.43, 86, 240, 113],
    [0.5, 148, 248, 66],
    [0.57, 196, 244, 34],
    [0.64, 232, 226, 22],
    [0.71, 254, 196, 21],
    [0.79, 255, 155, 23],
    [0.86, 237, 105, 37],
    [0.93, 204, 59, 43],
    [1, 122, 4, 3],
  ],
  cividis: [
    [0, 0, 32, 77],
    [0.25, 59, 77, 107],
    [0.5, 124, 123, 120],
    [0.75, 194, 176, 120],
    [1, 255, 234, 70],
  ],
  spectral: [
    [0, 158, 1, 66],
    [0.1, 213, 62, 79],
    [0.2, 244, 109, 67],
    [0.3, 253, 174, 97],
    [0.4, 254, 224, 139],
    [0.5, 255, 255, 191],
    [0.6, 230, 245, 152],
    [0.7, 171, 221, 164],
    [0.8, 102, 194, 165],
    [0.9, 50, 136, 189],
    [1, 94, 79, 162],
  ],
  rdylbu: [
    [0, 165, 0, 38],
    [0.1, 215, 48, 39],
    [0.2, 244, 109, 67],
    [0.3, 253, 174, 97],
    [0.4, 254, 224, 144],
    [0.5, 255, 255, 191],
    [0.6, 224, 243, 248],
    [0.7, 171, 217, 233],
    [0.8, 116, 173, 209],
    [0.9, 69, 117, 180],
    [1, 49, 54, 149],
  ],
  rdylgn: [
    [0, 165, 0, 38],
    [0.1, 215, 48, 39],
    [0.2, 244, 109, 67],
    [0.3, 253, 174, 97],
    [0.4, 254, 224, 139],
    [0.5, 255, 255, 191],
    [0.6, 217, 239, 139],
    [0.7, 166, 217, 106],
    [0.8, 102, 189, 99],
    [0.9, 26, 152, 80],
    [1, 0, 104, 55],
  ],
  hot: [
    [0, 11, 0, 0],
    [0.35, 255, 0, 0],
    [0.65, 255, 255, 0],
    [1, 255, 255, 255],
  ],
  greys: [
    [0, 255, 255, 255],
    [1, 0, 0, 0],
  ],
  terrain: [
    [0, 51, 51, 153],
    [0.15, 0, 153, 204],
    [0.25, 0, 204, 102],
    [0.5, 255, 255, 102],
    [0.75, 153, 102, 51],
    [1, 255, 255, 255],
  ],
  coolwarm: [
    [0, 59, 76, 192],
    [0.25, 141, 163, 236],
    [0.5, 221, 221, 221],
    [0.75, 231, 150, 120],
    [1, 180, 4, 38],
  ],
};

/** Interpolate between control points to produce a 256-entry RGBA LUT */
function interpolateLUT(stops: ColorStop[]): Uint8Array {
  const lut = new Uint8Array(256 * 4);

  for (let i = 0; i < 256; i++) {
    const t = i / 255;

    // Find bounding stops
    let lo = 0;
    let hi = stops.length - 1;
    for (let s = 0; s < stops.length - 1; s++) {
      if (t >= stops[s][0] && t <= stops[s + 1][0]) {
        lo = s;
        hi = s + 1;
        break;
      }
    }

    const tLo = stops[lo][0];
    const tHi = stops[hi][0];
    const frac = tHi === tLo ? 0 : (t - tLo) / (tHi - tLo);

    lut[i * 4] = Math.round(stops[lo][1] + frac * (stops[hi][1] - stops[lo][1]));
    lut[i * 4 + 1] = Math.round(
      stops[lo][2] + frac * (stops[hi][2] - stops[lo][2])
    );
    lut[i * 4 + 2] = Math.round(
      stops[lo][3] + frac * (stops[hi][3] - stops[lo][3])
    );
    lut[i * 4 + 3] = 255;
  }

  return lut;
}

// Pre-compute all LUTs
const LUT_CACHE: Record<string, Uint8Array> = {};

/** Get the 256-entry RGBA LUT for a named colormap */
export function getColormapLUT(name: string): Uint8Array {
  if (!LUT_CACHE[name]) {
    const stops = COLORMAP_DEFS[name];
    if (!stops) throw new Error(`Unknown colormap: ${name}`);
    LUT_CACHE[name] = interpolateLUT(stops);
  }
  return LUT_CACHE[name];
}

/** Names of all available colormaps */
export const COLORMAP_NAMES = Object.keys(COLORMAP_DEFS);

/** Draw a colormap preview onto a canvas element */
export function drawColormapPreview(
  canvas: HTMLCanvasElement,
  name: string,
  reversed = false,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const lut = getColormapLUT(name);
  const w = canvas.width;
  const h = canvas.height;
  const imgData = ctx.createImageData(w, h);

  for (let x = 0; x < w; x++) {
    let idx = Math.floor((x / (w - 1)) * 255);
    if (reversed) idx = 255 - idx;
    const r = lut[idx * 4];
    const g = lut[idx * 4 + 1];
    const b = lut[idx * 4 + 2];

    for (let y = 0; y < h; y++) {
      const off = (y * w + x) * 4;
      imgData.data[off] = r;
      imgData.data[off + 1] = g;
      imgData.data[off + 2] = b;
      imgData.data[off + 3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);
}
