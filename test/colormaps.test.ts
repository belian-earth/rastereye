import { describe, it, expect } from "vitest";
import { getColormapLUT, COLORMAP_NAMES, drawColormapPreview } from "../webview/colormaps";

describe("COLORMAP_NAMES", () => {
  it("exports a non-empty array of colormap names", () => {
    expect(COLORMAP_NAMES.length).toBeGreaterThan(0);
  });

  it("includes standard colormaps", () => {
    expect(COLORMAP_NAMES).toContain("viridis");
    expect(COLORMAP_NAMES).toContain("magma");
    expect(COLORMAP_NAMES).toContain("inferno");
    expect(COLORMAP_NAMES).toContain("plasma");
    expect(COLORMAP_NAMES).toContain("turbo");
    expect(COLORMAP_NAMES).toContain("spectral");
  });
});

describe("getColormapLUT", () => {
  it("returns a 256*4 byte Uint8Array", () => {
    const lut = getColormapLUT("viridis");
    expect(lut).toBeInstanceOf(Uint8Array);
    expect(lut.length).toBe(256 * 4);
  });

  it("has alpha=255 for all entries", () => {
    const lut = getColormapLUT("viridis");
    for (let i = 0; i < 256; i++) {
      expect(lut[i * 4 + 3]).toBe(255);
    }
  });

  it("starts with the correct color for viridis (dark purple)", () => {
    const lut = getColormapLUT("viridis");
    // First stop is [0, 68, 1, 84]
    expect(lut[0]).toBe(68);
    expect(lut[1]).toBe(1);
    expect(lut[2]).toBe(84);
  });

  it("ends with the correct color for viridis (yellow)", () => {
    const lut = getColormapLUT("viridis");
    // Last stop is [1, 253, 231, 37]
    expect(lut[255 * 4]).toBe(253);
    expect(lut[255 * 4 + 1]).toBe(231);
    expect(lut[255 * 4 + 2]).toBe(37);
  });

  it("produces monotonically increasing R channel for greys (inverted)", () => {
    // greys goes from white (255) to black (0)
    const lut = getColormapLUT("greys");
    expect(lut[0]).toBe(255); // start = white
    expect(lut[255 * 4]).toBe(0); // end = black
    // R channel should be monotonically decreasing
    for (let i = 1; i < 256; i++) {
      expect(lut[i * 4]).toBeLessThanOrEqual(lut[(i - 1) * 4]);
    }
  });

  it("caches LUT across calls", () => {
    const lut1 = getColormapLUT("magma");
    const lut2 = getColormapLUT("magma");
    expect(lut1).toBe(lut2); // same reference
  });

  it("throws for unknown colormap", () => {
    expect(() => getColormapLUT("nonexistent")).toThrow("Unknown colormap");
  });

  it("generates valid RGB values (0-255) for all colormaps", () => {
    for (const name of COLORMAP_NAMES) {
      const lut = getColormapLUT(name);
      for (let i = 0; i < lut.length; i++) {
        expect(lut[i]).toBeGreaterThanOrEqual(0);
        expect(lut[i]).toBeLessThanOrEqual(255);
      }
    }
  });

  it("produces different LUTs for different colormaps", () => {
    const viridis = getColormapLUT("viridis");
    const magma = getColormapLUT("magma");
    // At least some values should differ
    let differs = false;
    for (let i = 0; i < viridis.length; i++) {
      if (viridis[i] !== magma[i]) {
        differs = true;
        break;
      }
    }
    expect(differs).toBe(true);
  });
});

describe("drawColormapPreview", () => {
  it("is a function", () => {
    expect(typeof drawColormapPreview).toBe("function");
  });
});
