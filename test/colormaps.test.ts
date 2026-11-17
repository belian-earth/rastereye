import { describe, it, expect } from "vitest";
import { COLORMAP_INDEX } from "@developmentseed/deck.gl-raster/gpu-modules";
import { COLORMAP_NAMES, drawColormapPreview } from "../webview/colormaps";

describe("COLORMAP_NAMES", () => {
  it("lists only colormaps present in the GPU sprite", () => {
    // An unknown name would silently fall back to viridis on the GPU.
    const known = COLORMAP_INDEX as Record<string, number>;
    for (const name of COLORMAP_NAMES) {
      expect(known[name], name).toBeTypeOf("number");
    }
  });

  it("has no duplicates", () => {
    expect(new Set(COLORMAP_NAMES).size).toBe(COLORMAP_NAMES.length);
  });
});

describe("drawColormapPreview", () => {
  /// Two-row sprite, 4 px wide. Row 0 is a red ramp, row 1 a blue ramp.
  const sprite = {
    width: 4,
    data: Uint8ClampedArray.from([
      0, 0, 0, 255, 80, 0, 0, 255, 160, 0, 0, 255, 240, 0, 0, 255,
      0, 0, 10, 255, 0, 0, 20, 255, 0, 0, 30, 255, 0, 0, 40, 255,
    ]),
  };

  function fakeCanvas(w: number, h: number) {
    let drawn: Uint8ClampedArray | null = null;
    const canvas = {
      width: w,
      height: h,
      getContext: () => ({
        createImageData: (cw: number, ch: number) => ({ data: new Uint8ClampedArray(cw * ch * 4) }),
        putImageData: (img: { data: Uint8ClampedArray }) => { drawn = img.data; },
      }),
    } as unknown as HTMLCanvasElement;
    return { canvas, pixels: () => drawn! };
  }

  it("samples the requested sprite row across the canvas width", () => {
    const { canvas, pixels } = fakeCanvas(4, 2);
    drawColormapPreview(canvas, sprite, 1);
    const px = pixels();
    expect([px[2], px[6], px[10], px[14]]).toEqual([10, 20, 30, 40]);
    // Second canvas row repeats the first.
    expect([px[18], px[30]]).toEqual([10, 40]);
    expect(px[3]).toBe(255);
  });

  it("reverses the ramp", () => {
    const { canvas, pixels } = fakeCanvas(4, 1);
    drawColormapPreview(canvas, sprite, 0, true);
    const px = pixels();
    expect([px[0], px[4], px[8], px[12]]).toEqual([240, 160, 80, 0]);
  });
});
