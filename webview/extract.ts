/// Pure per-band pixel extraction shared by the GPU texture builders.
///
/// Tiles from @developmentseed/geotiff arrive in one of two layouts depending
/// on the file's PlanarConfiguration: pixel-interleaved (one buffer, stride =
/// samples-per-pixel) or band-separate (one buffer per band, GDAL
/// INTERLEAVE=BAND). Both are handled here.

/// Float32 sentinel for replaced NaN / nodata pixels. Far outside any plausible
/// raster value range, so it can be matched exactly by FilterNoDataVal.
export const NODATA_SENTINEL = -3.4028235e38;

export type TilePixels = {
  /** Pixel-interleaved buffer (PlanarConfiguration = 1). */
  data?: ArrayLike<number>;
  /** Per-band buffers (PlanarConfiguration = 2). */
  bands?: ArrayLike<number>[];
};

/// Strided view over one band, uniform across both tile layouts:
/// band value for pixel i is `src[base + i * stride]`.
export function bandView(
  px: TilePixels,
  spp: number,
  bandIdx: number,
): { src: ArrayLike<number>; stride: number; base: number } {
  const bi = Math.min(bandIdx, spp - 1);
  if (px.bands) {
    return { src: px.bands[bi], stride: 1, base: 0 };
  }
  return { src: px.data!, stride: spp, base: bi };
}

/// Extract one band as Float32, applying GDAL scale/offset and folding
/// NaN / nodata values into NODATA_SENTINEL for shader-side discard. The
/// sentinel is preserved verbatim (not run through scale/offset) so
/// FilterNoDataVal can match it exactly.
export function extractBand(
  px: TilePixels,
  pixelCount: number,
  spp: number,
  bandIdx: number,
  nodata: number | null,
  scale: number,
  offset: number,
): Float32Array {
  const out = new Float32Array(pixelCount);
  const { src, stride, base } = bandView(px, spp, bandIdx);
  for (let i = 0; i < pixelCount; i++) {
    const v = src[base + i * stride];
    out[i] = (v === nodata || v !== v)
      ? NODATA_SENTINEL
      : v * scale + offset;
  }
  return out;
}

/// Extract three bands into RGBA channels (alpha = 1) with the same
/// scale/offset baking and nodata-sentinel logic as `extractBand`.
export function extractRgba(
  px: TilePixels,
  pixelCount: number,
  spp: number,
  bandR: number,
  bandG: number,
  bandB: number,
  nodata: number | null,
  scales: [number, number, number],
  offsets: [number, number, number],
): Float32Array {
  const out = new Float32Array(pixelCount * 4);
  const r = bandView(px, spp, bandR);
  const g = bandView(px, spp, bandG);
  const b = bandView(px, spp, bandB);
  const [sR, sG, sB] = scales;
  const [oR, oG, oB] = offsets;

  for (let i = 0; i < pixelCount; i++) {
    const dnR = r.src[r.base + i * r.stride];
    const dnG = g.src[g.base + i * g.stride];
    const dnB = b.src[b.base + i * b.stride];
    const o = i * 4;
    out[o]     = (dnR === nodata || dnR !== dnR) ? NODATA_SENTINEL : dnR * sR + oR;
    out[o + 1] = (dnG === nodata || dnG !== dnG) ? NODATA_SENTINEL : dnG * sG + oG;
    out[o + 2] = (dnB === nodata || dnB !== dnB) ? NODATA_SENTINEL : dnB * sB + oB;
    out[o + 3] = 1;
  }
  return out;
}

/// Normalize a decoded tile array (either layout) into TilePixels plus its
/// samples-per-pixel count.
export function tilePixels(arr: {
  layout?: string;
  data?: ArrayLike<number>;
  bands?: ArrayLike<number>[];
  count?: number;
  width: number;
  height: number;
}): { px: TilePixels; spp: number } {
  if (arr.layout === "band-separate") {
    return {
      px: { bands: arr.bands! },
      spp: arr.count ?? arr.bands!.length,
    };
  }
  const data = arr.data!;
  const spp =
    arr.count ??
    Math.max(1, Math.round(data.length / (arr.width * arr.height)));
  return { px: { data }, spp };
}
