import { describe, it, expect } from "vitest";
import {
  invertAffine, applyAffine, locateCell, formatValue,
  tiledSource, stripSource, type Affine, type InspectSource,
} from "../webview/inspect";

/// North-up 10 m grid, origin (500000, 4000000), 100 x 50 cells.
const AFFINE: Affine = [10, 0, 500000, 0, -10, 4000000];

function fakeSource(over: Partial<InspectSource> = {}): InspectSource {
  const inv = invertAffine(AFFINE);
  return {
    width: 100,
    height: 50,
    crsLabel: "test",
    // Offsets small "lng/lat" into the projected grid: locateCell wraps
    // longitude to +/-180 before projecting.
    toNative: (lng, lat) => [500000 + lng, 3999500 + lat],
    pixelOf: (x, y) => {
      const [c, r] = applyAffine(inv, x, y);
      return [r, c];
    },
    readCell: async () => [],
    ...over,
  };
}

describe("affine helpers", () => {
  it("invertAffine round-trips a rotated transform", () => {
    const t: Affine = [9.8, 1.2, 1000, -1.1, -9.9, 2000];
    const inv = invertAffine(t);
    const [x, y] = applyAffine(t, 37.25, 12.5);
    const [c, r] = applyAffine(inv, x, y);
    expect(c).toBeCloseTo(37.25, 9);
    expect(r).toBeCloseTo(12.5, 9);
  });

  it("rejects a degenerate transform", () => {
    expect(() => invertAffine([0, 0, 1, 0, 0, 1])).toThrow();
  });
});

describe("locateCell", () => {
  it("returns the containing cell", () => {
    const hit = locateCell(fakeSource(), 15, 475);
    expect(hit).toMatchObject({ row: 2, col: 1 });
  });

  it("treats the lower-right edge as outside", () => {
    expect(locateCell(fakeSource({ width: 10 }), 100, 495)).toBeNull();
    expect(locateCell(fakeSource({ width: 10 }), 99, 495)).toMatchObject({ row: 0, col: 9 });
    expect(locateCell(fakeSource(), 5, 0)).toBeNull();
  });

  it("returns null when projection yields non-finite coordinates", () => {
    const src = fakeSource({ toNative: () => [NaN, NaN] });
    expect(locateCell(src, 0, 0)).toBeNull();
  });

  it("finds a cell clicked on an adjacent world copy", () => {
    // Geographic 1-degree grid covering lng 10..20, lat 0..10.
    const deg: Affine = [1, 0, 10, 0, -1, 10];
    const inv = invertAffine(deg);
    const src = fakeSource({
      toNative: (lng, lat) => [lng, lat],
      width: 10,
      height: 10,
      pixelOf: (x, y) => {
        const [c, r] = applyAffine(inv, x, y);
        return [r, c];
      },
    });
    expect(locateCell(src, 15.5 + 360, 4.5)).toMatchObject({ row: 5, col: 5 });
    expect(locateCell(src, 15.5 - 360, 4.5)).toMatchObject({ row: 5, col: 5 });
  });

  it("finds cells in a 0..360 longitude raster", () => {
    const deg: Affine = [1, 0, 180, 0, -1, 10];
    const inv = invertAffine(deg);
    const src = fakeSource({
      toNative: (lng, lat) => [lng, lat],
      width: 180,
      height: 10,
      pixelOf: (x, y) => {
        const [c, r] = applyAffine(inv, x, y);
        return [r, c];
      },
    });
    expect(locateCell(src, -100.5, 4.5)).toMatchObject({ row: 5, col: 79 });
  });
});

describe("tiledSource.readCell", () => {
  const signal = new AbortController().signal;

  function fakeTiff(calls: string[]) {
    return {
      width: 600, height: 300, tileWidth: 256, tileHeight: 256, crs: 32630,
      index: (x: number, y: number) => [y, x],
      // Edge tile (2,1) is clipped to 88 x 44; each pixel encodes its own
      // position so a wrong stride is visible in the result.
      fetchTile: async (tx: number, ty: number) => {
        calls.push(`${tx},${ty}`);
        const width = Math.min(256, 600 - tx * 256);
        const height = Math.min(256, 300 - ty * 256);
        const data = new Float32Array(width * height * 2);
        for (let r = 0; r < height; r++) {
          for (let c = 0; c < width; c++) {
            data[(r * width + c) * 2] = ty * 256 + r;
            data[(r * width + c) * 2 + 1] = tx * 256 + c;
          }
        }
        return { array: { layout: "pixel-interleaved", data, count: 2, width, height } };
      },
    };
  }

  it("indexes clipped edge tiles by their actual width", async () => {
    const src = tiledSource(fakeTiff([]), (x, y) => [x, y], null);
    expect(await src.readCell(299, 599, signal)).toEqual([299, 599]);
    expect(await src.readCell(260, 520, signal)).toEqual([260, 520]);
  });

  it("reads band-separate tiles", async () => {
    const tiff = {
      width: 4, height: 4, tileWidth: 4, tileHeight: 4, crs: 4326,
      index: (x: number, y: number) => [y, x],
      fetchTile: async () => ({
        array: {
          layout: "band-separate",
          bands: [Uint8Array.from({ length: 16 }, (_, i) => i),
                  Uint8Array.from({ length: 16 }, (_, i) => 100 + i)],
          count: 2, width: 4, height: 4,
        },
      }),
    };
    const src = tiledSource(tiff, (x, y) => [x, y], null);
    expect(await src.readCell(2, 3, signal)).toEqual([11, 111]);
  });

  it("fetches a tile once for repeat reads", async () => {
    const calls: string[] = [];
    const src = tiledSource(fakeTiff(calls), (x, y) => [x, y], null);
    await src.readCell(1, 1, signal);
    await src.readCell(5, 9, signal);
    await src.readCell(1, 300, signal);
    expect(calls).toEqual(["0,0", "1,0"]);
  });
});

describe("stripSource.readCell", () => {
  const signal = new AbortController().signal;
  const tiff = {
    width: 4, height: 3, crs: 4326,
    index: (x: number, y: number, op: (n: number) => number) => [op(3 - y), op(x)],
  };
  const project = (lng: number, lat: number): [number, number] => [lng, lat];

  it("reads full-resolution bands directly", async () => {
    const bands = [Uint16Array.from({ length: 12 }, (_, i) => i), Uint16Array.from({ length: 12 }, (_, i) => i * 10)];
    const src = stripSource({ tiff, projectFrom4326: project, bands, image: null });
    expect(await src.readCell(2, 1, signal)).toEqual([9, 90]);
    expect(src.pixelOf(1.5, 0.5)).toEqual([2.5, 1.5]);
    expect(src.crsLabel).toBe("EPSG:4326");
  });

  it("reads the true cell from the image when display bands are decimated", async () => {
    const windows: number[][] = [];
    const image = {
      readRasters: async ({ window }: { window: number[] }) => {
        windows.push(window);
        return [Float32Array.of(7), Float32Array.of(8)];
      },
    };
    const src = stripSource({ tiff, projectFrom4326: project, bands: [new Uint8Array(2)], image });
    expect(await src.readCell(2, 3, signal)).toEqual([7, 8]);
    expect(windows).toEqual([[3, 2, 4, 3]]);
  });
});

describe("formatValue", () => {
  it("formats integers, floats and extremes", () => {
    expect(formatValue(1234)).toBe("1234");
    expect(formatValue(0.1 + 0.2)).toBe("0.3");
    expect(formatValue(5.41257762908936)).toBe("5.412578");
    expect(formatValue(0.00002345)).toBe("2.3450e-5");
    expect(formatValue(NaN)).toBe("NaN");
    expect(formatValue(-Infinity)).toBe("-Inf");
  });
});
