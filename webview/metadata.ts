/// File metadata shared by the tiled and strip paths. Both read it from the
/// same @developmentseed/geotiff header, so band names, scale/offset and
/// nodata are identical whichever way the pixels are stored.

import {
  setGeotiffObj, setBandCount, setNodataValue, setBandScales,
  setBandOffsets, setBandNames, setScalingActive, scalingActive,
} from "./state";
import { dnToScaled } from "./helpers";

/// TIFF Compression tag value for LERC.
const COMPRESSION_LERC = 34887;

/// Per-band descriptions from a GDALMetadata XML string ("" when absent).
export function parseBandNames(xml: string, bandCount: number): string[] {
  const names = new Array<string>(bandCount).fill("");
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  doc.querySelectorAll('Item[name="DESCRIPTION"][sample]').forEach((item) => {
    const b = parseInt(item.getAttribute("sample")!, 10);
    if (b >= 0 && b < bandCount) names[b] = item.textContent ?? "";
  });
  return names;
}

/// True when the TIFF carries no georeferencing at all.
export function hasNoGeoreference(tiff: any): boolean {
  const gkd = tiff.gkd;
  return !gkd || Object.values(gkd).every((v) => v == null);
}

export function isLerc(tiff: any): boolean {
  return tiff.cachedPrimaryImageTags?.compression === COMPRESSION_LERC;
}

/// TIFF PhotometricInterpretation value for palette (colour-table) images.
const PHOTOMETRIC_PALETTE = 3;

/// The file's own colour table as RGBA bytes, one entry per pixel value, or
/// null when the file is not a single-band palette image. Only 256-entry
/// (8-bit) tables are supported; that is what the colormap shader samples.
export function paletteOf(tiff: any): Uint8ClampedArray | null {
  const tags = tiff.cachedPrimaryImageTags;
  const cmap: ArrayLike<number> | undefined = tags?.colorMap;
  if (tags?.photometric !== PHOTOMETRIC_PALETTE || !cmap) return null;
  const size = cmap.length / 3;
  if (size !== 256 || (tiff.count ?? 1) !== 1) return null;
  const rgba = new Uint8ClampedArray(size * 4);
  for (let i = 0; i < size; i++) {
    // ColorMap holds all reds, then greens, then blues, as 16-bit values.
    rgba[4 * i] = cmap[i] >> 8;
    rgba[4 * i + 1] = cmap[size + i] >> 8;
    rgba[4 * i + 2] = cmap[2 * size + i] >> 8;
    rgba[4 * i + 3] = 255;
  }
  return rgba;
}

/// Populate shared state from an opened GeoTIFF header.
export function applyMetadata(tiff: any): void {
  setGeotiffObj(tiff);
  const count: number = tiff.count ?? 1;
  setBandCount(count);
  setNodataValue(tiff.nodata ?? null);

  let scales: number[] = [];
  let offsets: number[] = [];
  try {
    scales = Array.from(tiff.scales ?? []);
    offsets = Array.from(tiff.offsets ?? []);
  } catch { /* malformed metadata: treat as unscaled */ }
  setBandScales(scales);
  setBandOffsets(offsets);
  setScalingActive(scales.some((s) => s !== 1) || offsets.some((o) => o !== 0));

  let names: string[] = [];
  try {
    const xml: string | null = tiff.cachedPrimaryImageTags?.gdalMetadata ?? null;
    if (xml) names = parseBandNames(xml, count);
  } catch { /* ignore */ }
  setBandNames(names);
}

/// Stretch used until percentiles arrive, from the sample type alone.
export function fallbackRange(tiff: any): [number, number] {
  const tags = tiff.cachedPrimaryImageTags;
  const bps = tags?.bitsPerSample?.[0] ?? 8;
  const sf = tags?.sampleFormat?.[0] ?? 1; // 1 uint, 2 int, 3 float
  let min = 0;
  let max = 255;
  if (sf === 3) {
    max = 1;
  } else if (bps > 8) {
    max = sf === 2 ? 32767 : 10000;
  }
  if (scalingActive) {
    min = dnToScaled(min, 0);
    max = dnToScaled(max, 0);
    if (min > max) [min, max] = [max, min];
  }
  return [min, max];
}
