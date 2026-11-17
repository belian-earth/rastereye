import { describe, it, expect } from "vitest";
import { percentileRange, PixelSample } from "../webview/percentiles";

const ramp = (n: number) => Float32Array.from({ length: n }, (_, i) => i);
const sample = (data: ArrayLike<number>, spp = 1): PixelSample =>
  ({ px: { data }, spp, pixelCount: data.length / spp });

describe("percentileRange", () => {
  it("returns the 2nd and 98th percentiles", () => {
    expect(percentileRange([sample(ramp(1000))], 0, null, 1, 0)).toEqual([20, 980]);
  });

  it("returns null with too few valid values", () => {
    expect(percentileRange([sample(ramp(5))], 0, null, 1, 0)).toBeNull();
    expect(percentileRange([], 0, null, 1, 0)).toBeNull();
    expect(percentileRange([sample(new Float32Array(100).fill(NaN))], 0, null, 1, 0)).toBeNull();
  });

  it("excludes nodata, including float32 nodata that is not exactly representable", () => {
    const data = ramp(1000);
    for (let i = 0; i < 500; i++) data[i] = -9999.99; // stored as fround(-9999.99)
    const [lo, hi] = percentileRange([sample(data)], 0, -9999.99, 1, 0)!;
    expect(lo).toBe(510);
    expect(hi).toBe(990);
  });

  it("excludes pixels the internal mask marks invalid", () => {
    const mask = Uint8Array.from({ length: 1000 }, (_, i) => (i < 500 ? 0 : 255));
    const s = { ...sample(ramp(1000)), mask };
    expect(percentileRange([s], 0, null, 1, 0)).toEqual([510, 990]);
  });

  it("applies scale and offset", () => {
    expect(percentileRange([sample(ramp(1000))], 0, null, 0.1, 5)).toEqual([7, 103]);
  });

  it("reads the requested band from interleaved and band-separate samples", () => {
    const interleaved = Float32Array.from({ length: 2000 }, (_, i) => (i % 2 ? 5000 + (i >> 1) : i >> 1));
    expect(percentileRange([sample(interleaved, 2)], 1, null, 1, 0)).toEqual([5020, 5980]);
    const separate: PixelSample = { px: { bands: [ramp(1000), ramp(1000).map((v) => v + 100)] }, spp: 2, pixelCount: 1000 };
    expect(percentileRange([separate], 1, null, 1, 0)).toEqual([120, 1080]);
  });

  it("pools several samples", () => {
    const a = sample(ramp(500));
    const b = sample(ramp(500).map((v) => v + 500));
    expect(percentileRange([a, b], 0, null, 1, 0)).toEqual([20, 980]);
  });

  it("subsamples large inputs without changing the result materially", () => {
    const [lo, hi] = percentileRange([sample(ramp(100000))], 0, null, 1, 0, 1000)!;
    expect(lo).toBeGreaterThan(1500);
    expect(lo).toBeLessThan(2500);
    expect(hi).toBeGreaterThan(97500);
    expect(hi).toBeLessThan(98500);
  });
});
