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

describe("nodata matching and masks", () => {
  it("masks float32 nodata that is not exactly representable", () => {
    for (const nodata of [-9999.99, 1e20]) {
      const data = Float32Array.of(1, nodata, 3);
      const out = extractBand({ data }, 3, 1, 0, nodata, 1, 0);
      expect(Array.from(out)).toEqual([1, SENTINEL_F32, 3]);
    }
  });

  it("masks float32 nodata in every RGB channel", () => {
    const nd = -9999.99;
    const data = Float32Array.of(nd, 2, 3, 4, nd, 6);
    const out = extractRgba({ data }, 2, 3, 0, 1, 2, nd, [1, 1, 1], [0, 0, 0]);
    expect(out[0]).toBe(SENTINEL_F32);
    expect(out[1]).toBe(2);
    expect(out[5]).toBe(SENTINEL_F32);
  });

  it("does not treat 0 as nodata when the file declares none", () => {
    const out = extractBand({ data: Uint8Array.of(0, 5) }, 2, 1, 0, null, 1, 0);
    expect(Array.from(out)).toEqual([0, 5]);
  });

  it("folds pixels the internal mask marks invalid into the sentinel", () => {
    const mask = Uint8Array.of(255, 0, 255);
    const out = extractBand({ data: Uint8Array.of(7, 8, 9) }, 3, 1, 0, null, 2, 1, mask);
    expect(Array.from(out)).toEqual([15, SENTINEL_F32, 19]);
    const rgba = extractRgba(
      { data: Uint8Array.of(1, 2, 3, 4, 5, 6) }, 2, 3, 0, 1, 2, null,
      [1, 1, 1], [0, 0, 0], Uint8Array.of(0, 255),
    );
    expect(Array.from(rgba.slice(0, 3))).toEqual([SENTINEL_F32, SENTINEL_F32, SENTINEL_F32]);
    expect(Array.from(rgba.slice(4, 7))).toEqual([4, 5, 6]);
  });
});

describe("tilePixels with packed band-sequential data", () => {
  it("splits a single array holding every band into per-band views", () => {
    // 2x1 tile, 3 bands, as the LERC decoder returns pixel-interleaved files.
    const packed = Uint16Array.of(1, 2, 10, 20, 100, 200);
    const { px, spp } = tilePixels({
      layout: "band-separate", bands: [packed], count: 3, width: 2, height: 1,
    });
    expect(spp).toBe(3);
    expect(px.bands!.map((b) => Array.from(b))).toEqual([[1, 2], [10, 20], [100, 200]]);
  });

  it("leaves a genuine single-band tile alone", () => {
    const band = Uint8Array.of(1, 2);
    const { px, spp } = tilePixels({
      layout: "band-separate", bands: [band], count: 1, width: 2, height: 1,
    });
    expect(spp).toBe(1);
    expect(px.bands![0]).toBe(band);
  });
});
