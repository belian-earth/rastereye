/// Percentile computation for the automatic 2-98% stretch.
///
/// Path-agnostic: the active render path registers a provider that returns
/// one or more pixel samples (decoded tiles, or the strip image's bands).

import { nodataValue, scalingActive, bandScales, bandOffsets, bandCount } from "./state";
import { isAbortError } from "./helpers";
import { setRange } from "./range";
import { bandView, TilePixels } from "./extract";

export interface PixelSample {
  px: TilePixels;
  spp: number;
  pixelCount: number;
  mask?: ArrayLike<number> | null;
}

type SampleProvider = () => Promise<PixelSample[]>;

/// Upper bound on values sorted per band. Larger inputs are subsampled on a
/// regular stride, which keeps the sort near 100 ms instead of seconds.
const MAX_VALUES = 1 << 20;

let provider: SampleProvider | null = null;
let samplesPromise: Promise<PixelSample[]> | null = null;
let seq = 0;

export function setSampleProvider(p: SampleProvider | null): void {
  provider = p;
  samplesPromise = null;
}

/// 2nd and 98th percentile of one band across the samples, in display units,
/// or null when fewer than 10 valid values exist.
export function percentileRange(
  samples: PixelSample[],
  bandIdx: number,
  nodata: number | null,
  scale: number,
  offset: number,
  maxValues = MAX_VALUES,
): [number, number] | null {
  const total = samples.reduce((n, s) => n + s.pixelCount, 0);
  if (total === 0) return null;
  const step = Math.max(1, Math.ceil(total / maxValues));
  const values = new Float64Array(Math.ceil(total / step) + samples.length);
  const nd = nodata ?? NaN;
  const ndf = Math.fround(nd);
  let n = 0;
  for (const s of samples) {
    const { src, stride, base } = bandView(s.px, s.spp, bandIdx);
    const mask = s.mask;
    for (let i = 0; i < s.pixelCount; i += step) {
      const v = src[base + i * stride];
      if (v === nd || v === ndf || v !== v || (mask && mask[i] === 0)) continue;
      values[n++] = v * scale + offset;
    }
  }
  if (n < 10) return null;
  const sorted = values.subarray(0, n).sort();
  return [sorted[Math.floor(n * 0.02)], sorted[Math.floor(n * 0.98)]];
}

/// Compute and apply the stretch for a band. If the band changes while the
/// samples are still loading, only the latest request applies its result.
export async function computePercentilesForBand(bandIdx: number): Promise<void> {
  if (!provider) return;
  const mine = ++seq;
  try {
    if (!samplesPromise) {
      samplesPromise = provider();
      // A failed sample must not be cached: the next band change retries.
      samplesPromise.catch(() => { samplesPromise = null; });
    }
    const samples = await samplesPromise;
    if (mine !== seq) return;
    const bi = Math.min(bandIdx, bandCount - 1);
    const scale = scalingActive ? (bandScales[bi] ?? 1) : 1;
    const offset = scalingActive ? (bandOffsets[bi] ?? 0) : 0;
    const range = percentileRange(samples, bi, nodataValue, scale, offset);
    if (range) setRange(range[0], range[1]);
  } catch (err) {
    if (isAbortError(err)) return;
    console.warn("[RasterEye] Could not compute percentiles:", err);
  }
}
