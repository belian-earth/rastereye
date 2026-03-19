import { describe, it, expect } from "vitest";

/**
 * Tests for the pixel processing logic used in buildTexture.
 * Since buildTexture is tightly coupled to the webview (needs device.createTexture),
 * we test the underlying math in isolation.
 */

// Replicate the core pixel processing from main.ts buildTexture
function processSingleBand(
  data: ArrayLike<number>,
  spp: number,
  bandIdx: number,
  nodata: number | null,
  scale: number,
  offset: number,
  vMin: number,
  vMax: number,
  lut: Uint8Array
): Uint8Array {
  const pixelCount = data.length / spp;
  const range = vMax - vMin || 1;
  const out = new Uint8Array(pixelCount * 4);

  for (let i = 0; i < pixelCount; i++) {
    const dn = data[i * spp + bandIdx];
    if (dn === nodata || dn !== dn) {
      out[i * 4 + 3] = 0;
      continue;
    }
    const frac = ((dn * scale + offset - vMin) / range) * 255;
    const n = frac < 0 ? 0 : frac > 255 ? 255 : (frac + 0.5) | 0;
    out[i * 4] = lut[n * 4];
    out[i * 4 + 1] = lut[n * 4 + 1];
    out[i * 4 + 2] = lut[n * 4 + 2];
    out[i * 4 + 3] = 255;
  }
  return out;
}

function processRGB(
  data: ArrayLike<number>,
  spp: number,
  ri: number,
  gi: number,
  bi: number,
  nodata: number | null,
  scales: number[],
  offsets: number[],
  vMin: number,
  vMax: number
): Uint8Array {
  const pixelCount = data.length / spp;
  const range = vMax - vMin || 1;
  const out = new Uint8Array(pixelCount * 4);

  for (let i = 0; i < pixelCount; i++) {
    const dnR = data[i * spp + ri];
    if (dnR === nodata || dnR !== dnR) {
      out[i * 4 + 3] = 0;
      continue;
    }
    const vr = ((dnR * scales[0] + offsets[0] - vMin) / range) * 255;
    const vg =
      ((data[i * spp + gi] * scales[1] + offsets[1] - vMin) / range) * 255;
    const vb =
      ((data[i * spp + bi] * scales[2] + offsets[2] - vMin) / range) * 255;
    out[i * 4] = vr < 0 ? 0 : vr > 255 ? 255 : (vr + 0.5) | 0;
    out[i * 4 + 1] = vg < 0 ? 0 : vg > 255 ? 255 : (vg + 0.5) | 0;
    out[i * 4 + 2] = vb < 0 ? 0 : vb > 255 ? 255 : (vb + 0.5) | 0;
    out[i * 4 + 3] = 255;
  }
  return out;
}

// Simple greyscale LUT for testing (value i → grey i)
function makeGreyLUT(): Uint8Array {
  const lut = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    lut[i * 4] = i;
    lut[i * 4 + 1] = i;
    lut[i * 4 + 2] = i;
    lut[i * 4 + 3] = 255;
  }
  return lut;
}

describe("processSingleBand", () => {
  const greyLUT = makeGreyLUT();

  it("maps Uint8 data linearly with identity scale", () => {
    const data = new Uint16Array([0, 128, 255]);
    const out = processSingleBand(data, 1, 0, null, 1, 0, 0, 255, greyLUT);
    expect(out[0 * 4]).toBe(0); // DN=0 → 0
    expect(out[1 * 4]).toBe(128); // DN=128 → 128
    expect(out[2 * 4]).toBe(255); // DN=255 → 255
  });

  it("applies scale and offset", () => {
    // DN=1000, scale=0.0001, offset=-0.1 → value=0.0
    // DN=5000, scale=0.0001, offset=-0.1 → value=0.4
    const data = new Uint16Array([1000, 5000]);
    const out = processSingleBand(
      data,
      1,
      0,
      null,
      0.0001,
      -0.1,
      0.0,
      0.5,
      greyLUT
    );
    // value=0.0, range=0.5: (0.0 - 0.0) / 0.5 * 255 = 0
    expect(out[0 * 4]).toBe(0);
    // value=0.4, range=0.5: (0.4 - 0.0) / 0.5 * 255 = 204
    expect(out[1 * 4]).toBe(204);
  });

  it("marks nodata as transparent", () => {
    const data = new Uint16Array([100, 0, 200]);
    const out = processSingleBand(data, 1, 0, 0, 1, 0, 0, 255, greyLUT);
    // Pixel 0: valid
    expect(out[0 * 4 + 3]).toBe(255);
    // Pixel 1: nodata=0
    expect(out[1 * 4 + 3]).toBe(0);
    // Pixel 2: valid
    expect(out[2 * 4 + 3]).toBe(255);
  });

  it("marks NaN as transparent", () => {
    const data = new Float32Array([1.0, NaN, 2.0]);
    const out = processSingleBand(data, 1, 0, null, 1, 0, 0, 3, greyLUT);
    expect(out[0 * 4 + 3]).toBe(255);
    expect(out[1 * 4 + 3]).toBe(0); // NaN → transparent
    expect(out[2 * 4 + 3]).toBe(255);
  });

  it("clamps values below min to 0", () => {
    const data = new Float32Array([0.0]);
    const out = processSingleBand(data, 1, 0, null, 1, 0, 10, 20, greyLUT);
    expect(out[0]).toBe(0); // (0 - 10) / 10 * 255 < 0 → clamped to 0
  });

  it("clamps values above max to 255", () => {
    const data = new Float32Array([100.0]);
    const out = processSingleBand(data, 1, 0, null, 1, 0, 0, 10, greyLUT);
    expect(out[0]).toBe(255); // (100 - 0) / 10 * 255 > 255 → clamped
  });

  it("extracts correct band from multi-band interleaved data", () => {
    // 2 pixels, 3 bands each: [p0b0, p0b1, p0b2, p1b0, p1b1, p1b2]
    const data = new Uint16Array([10, 20, 30, 40, 50, 60]);
    const out = processSingleBand(data, 3, 1, null, 1, 0, 0, 100, greyLUT);
    // Band 1: values 20 and 50
    // 20/100 * 255 = 51
    expect(out[0 * 4]).toBe(51);
    // 50/100 * 255 = 128 (127.5 rounded)
    expect(out[1 * 4]).toBe(128);
  });
});

describe("processRGB", () => {
  it("maps 3 bands to RGB channels", () => {
    // 1 pixel, 4 bands: [100, 150, 200, 0]
    const data = new Uint16Array([100, 150, 200, 0]);
    const out = processRGB(
      data,
      4,
      0,
      1,
      2,
      null,
      [1, 1, 1],
      [0, 0, 0],
      0,
      255
    );
    expect(out[0]).toBe(100); // R
    expect(out[1]).toBe(150); // G
    expect(out[2]).toBe(200); // B
    expect(out[3]).toBe(255); // A
  });

  it("applies per-band scale/offset", () => {
    const data = new Uint16Array([1000, 2000, 3000]);
    const out = processRGB(
      data,
      3,
      0,
      1,
      2,
      null,
      [0.0001, 0.0001, 0.0001],
      [-0.1, -0.1, -0.1],
      0.0,
      0.3
    );
    // Band 0: 1000*0.0001 + (-0.1) = 0.0 → 0/0.3 * 255 = 0
    expect(out[0]).toBe(0);
    // Band 1: 2000*0.0001 + (-0.1) = 0.1 → 0.1/0.3 * 255 = 85
    expect(out[1]).toBe(85);
    // Band 2: 3000*0.0001 + (-0.1) = 0.2 → 0.2/0.3 * 255 = 170
    expect(out[2]).toBe(170);
  });

  it("marks nodata pixels as transparent", () => {
    const data = new Uint16Array([0, 100, 200]);
    const out = processRGB(data, 3, 0, 1, 2, 0, [1, 1, 1], [0, 0, 0], 0, 255);
    // nodata=0, first band (R) is 0 → transparent
    expect(out[3]).toBe(0);
  });

  it("allows band reordering (false color)", () => {
    // 1 pixel, 4 bands
    const data = new Uint16Array([10, 20, 30, 40]);
    // Map: R=band3, G=band1, B=band0
    const out = processRGB(
      data,
      4,
      3,
      1,
      0,
      null,
      [1, 1, 1],
      [0, 0, 0],
      0,
      255
    );
    expect(out[0]).toBe(40); // R = band 3
    expect(out[1]).toBe(20); // G = band 1
    expect(out[2]).toBe(10); // B = band 0
  });
});
