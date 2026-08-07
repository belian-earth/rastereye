import { describe, it, expect } from "vitest";
import {
  NODATA_SENTINEL,
  extractBand,
  extractRgba,
  tilePixels,
} from "../webview/extract";

// The sentinel as it round-trips through a Float32Array.
const SENTINEL_F32 = Math.fround(NODATA_SENTINEL);

// 2x2 tile, 3 bands. Band values: b0 = [1,2,3,4], b1 = [10,20,30,40],
// b2 = [100,200,300,400]. Same pixels expressed in both layouts.
const interleaved = {
  data: new Float32Array([
    1, 10, 100,
    2, 20, 200,
    3, 30, 300,
    4, 40, 400,
  ]),
};
const separate = {
  bands: [
    new Float32Array([1, 2, 3, 4]),
    new Float32Array([10, 20, 30, 40]),
    new Float32Array([100, 200, 300, 400]),
  ],
};

describe("extractBand", () => {
  it.each([
    ["pixel-interleaved", interleaved],
    ["band-separate", separate],
  ])("extracts the chosen band (%s)", (_name, px) => {
    const out = extractBand(px, 4, 3, 1, null, 1, 0);
    expect(Array.from(out)).toEqual([10, 20, 30, 40]);
  });

  it.each([
    ["pixel-interleaved", interleaved],
    ["band-separate", separate],
  ])("applies scale and offset (%s)", (_name, px) => {
    const out = extractBand(px, 4, 3, 0, null, 2, 5);
    expect(Array.from(out)).toEqual([7, 9, 11, 13]);
  });

  it("folds nodata and NaN into the sentinel, bypassing scale/offset", () => {
    const px = { bands: [new Float32Array([1, -9999, NaN, 4])] };
    const out = extractBand(px, 4, 1, 0, -9999, 10, 1);
    expect(out[0]).toBe(11);
    expect(out[1]).toBe(SENTINEL_F32);
    expect(out[2]).toBe(SENTINEL_F32);
    expect(out[3]).toBe(41);
  });

  it("clamps an out-of-range band index to the last band", () => {
    const out = extractBand(separate, 4, 3, 7, null, 1, 0);
    expect(Array.from(out)).toEqual([100, 200, 300, 400]);
  });
});

describe("extractRgba", () => {
  it.each([
    ["pixel-interleaved", interleaved],
    ["band-separate", separate],
  ])("interleaves selected bands into RGBA with alpha 1 (%s)", (_name, px) => {
    const out = extractRgba(px, 4, 3, 2, 1, 0, null, [1, 1, 1], [0, 0, 0]);
    // Pixel 0: R=b2, G=b1, B=b0, A=1
    expect(Array.from(out.slice(0, 4))).toEqual([100, 10, 1, 1]);
    expect(Array.from(out.slice(12, 16))).toEqual([400, 40, 4, 1]);
  });

  it("applies per-channel scale/offset and per-channel nodata sentinel", () => {
    const out = extractRgba(
      separate, 4, 3, 0, 1, 2, 30, [2, 2, 2], [0, 1, 2],
    );
    // Pixel 2: b0=3 → 6, b1=30 is nodata → sentinel, b2=300 → 602
    expect(out[8]).toBe(6);
    expect(out[9]).toBe(SENTINEL_F32);
    expect(out[10]).toBe(602);
  });
});

describe("tilePixels", () => {
  it("normalizes a band-separate tile array", () => {
    const { px, spp } = tilePixels({
      layout: "band-separate",
      bands: separate.bands,
      count: 3,
      width: 2,
      height: 2,
    });
    expect(px.bands).toBe(separate.bands);
    expect(spp).toBe(3);
  });

  it("normalizes a pixel-interleaved tile array, inferring spp when count is absent", () => {
    const { px, spp } = tilePixels({
      layout: "pixel-interleaved",
      data: interleaved.data,
      width: 2,
      height: 2,
    });
    expect(px.data).toBe(interleaved.data);
    expect(spp).toBe(3);
  });
});
