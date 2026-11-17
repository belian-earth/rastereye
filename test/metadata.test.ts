// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  parseBandNames, hasNoGeoreference, isLerc, applyMetadata, fallbackRange, paletteOf,
} from "../webview/metadata";
import * as state from "../webview/state";

const XML = `<GDALMetadata>
  <Item name="AREA_OR_POINT">Area</Item>
  <Item name="DESCRIPTION" sample="0" role="description">red</Item>
  <Item name="SCALE" sample="0" role="scale">0.0001</Item>
  <Item name="DESCRIPTION" sample="2" role="description">nir</Item>
  <Item name="DESCRIPTION" sample="9" role="description">out of range</Item>
</GDALMetadata>`;

function fakeTiff(over: Record<string, unknown> = {}) {
  return {
    count: 3,
    nodata: -9999,
    scales: [1, 1, 1],
    offsets: [0, 0, 0],
    gkd: { projectedType: 32630, geographicType: null },
    cachedPrimaryImageTags: {
      gdalMetadata: XML,
      compression: 8,
      bitsPerSample: Uint16Array.of(16, 16, 16),
      sampleFormat: Uint16Array.of(1, 1, 1),
    },
    ...over,
  };
}

describe("parseBandNames", () => {
  it("reads per-band descriptions and ignores out-of-range samples", () => {
    expect(parseBandNames(XML, 3)).toEqual(["red", "", "nir"]);
  });
});

describe("georeference and compression checks", () => {
  it("detects a TIFF with no geo keys", () => {
    expect(hasNoGeoreference({ gkd: { projectedType: null, geographicType: null } })).toBe(true);
    expect(hasNoGeoreference({ gkd: null })).toBe(true);
    expect(hasNoGeoreference(fakeTiff())).toBe(false);
  });

  it("detects LERC compression", () => {
    expect(isLerc(fakeTiff())).toBe(false);
    expect(isLerc(fakeTiff({ cachedPrimaryImageTags: { compression: 34887 } }))).toBe(true);
  });
});

describe("applyMetadata", () => {
  beforeEach(() => applyMetadata(fakeTiff()));

  it("sets band count, nodata and names", () => {
    expect(state.bandCount).toBe(3);
    expect(state.nodataValue).toBe(-9999);
    expect(state.bandNames).toEqual(["red", "", "nir"]);
    expect(state.scalingActive).toBe(false);
  });

  it("activates scaling when any band has a scale or offset", () => {
    applyMetadata(fakeTiff({ scales: [0.0001, 1, 1], offsets: [-0.1, 0, 0] }));
    expect(state.scalingActive).toBe(true);
    expect(state.bandScales).toEqual([0.0001, 1, 1]);
  });

  it("treats a missing nodata tag as null", () => {
    applyMetadata(fakeTiff({ nodata: undefined }));
    expect(state.nodataValue).toBeNull();
  });
});

describe("fallbackRange", () => {
  const tags = (bits: number, format: number) => fakeTiff({
    cachedPrimaryImageTags: {
      bitsPerSample: Uint16Array.of(bits), sampleFormat: Uint16Array.of(format),
    },
  });

  it("uses the sample type", () => {
    applyMetadata(fakeTiff());
    expect(fallbackRange(tags(8, 1))).toEqual([0, 255]);
    expect(fallbackRange(tags(16, 1))).toEqual([0, 10000]);
    expect(fallbackRange(tags(16, 2))).toEqual([0, 32767]);
    // sampleFormat is an array: comparing the array itself to 3 never matched,
    // which left float rasters on a 0-255 stretch.
    expect(fallbackRange(tags(32, 3))).toEqual([0, 1]);
  });

  it("applies band scale and offset, keeping min below max", () => {
    applyMetadata(fakeTiff({ scales: [-0.001, 1, 1], offsets: [5, 0, 0] }));
    expect(fallbackRange(tags(16, 1))).toEqual([-5, 5]);
  });
});

describe("paletteOf", () => {
  // ColorMap layout: 256 reds, 256 greens, 256 blues, 16-bit each.
  const colorMap = new Uint16Array(768);
  colorMap[4] = 0x1200; colorMap[256 + 4] = 0xa0ff; colorMap[512 + 4] = 0xffff;
  const palette = (over: Record<string, unknown> = {}) => fakeTiff({
    count: 1,
    cachedPrimaryImageTags: { photometric: 3, colorMap },
    ...over,
  });

  it("converts the colour table to 8-bit RGBA", () => {
    const rgba = paletteOf(palette())!;
    expect(rgba.length).toBe(1024);
    expect(Array.from(rgba.slice(16, 20))).toEqual([0x12, 0xa0, 0xff, 255]);
  });

  it("returns null for non-palette, multi-band or non-8-bit files", () => {
    expect(paletteOf(fakeTiff())).toBeNull();
    expect(paletteOf(palette({ count: 2 }))).toBeNull();
    expect(paletteOf(palette({
      cachedPrimaryImageTags: { photometric: 3, colorMap: new Uint16Array(3 * 65536) },
    }))).toBeNull();
    expect(paletteOf(palette({
      cachedPrimaryImageTags: { photometric: 1, colorMap },
    }))).toBeNull();
  });
});
