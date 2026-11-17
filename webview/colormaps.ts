/// Colormaps offered in the control panel. Each name must be a layer of the
/// colormap sprite shipped with deck.gl-raster (COLORMAP_INDEX).

export const COLORMAP_NAMES = [
  "viridis", "magma", "inferno", "plasma", "turbo", "cividis", "spectral",
  "rdylbu", "rdylgn", "hot", "greys", "terrain", "coolwarm",
];

/// Draw one colormap onto the preview canvas, sampled from the same sprite
/// the GPU uses (256 px wide, one row per colormap), so the preview cannot
/// drift from the rendered colours.
export function drawColormapPreview(
  canvas: HTMLCanvasElement,
  sprite: { data: ArrayLike<number>; width: number },
  row: number,
  reversed = false,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  const out = ctx.createImageData(w, h);
  const last = sprite.width - 1;
  for (let x = 0; x < w; x++) {
    let idx = w > 1 ? Math.round((x / (w - 1)) * last) : 0;
    if (reversed) idx = last - idx;
    const src = (row * sprite.width + idx) * 4;
    for (let y = 0; y < h; y++) {
      const off = (y * w + x) * 4;
      out.data[off] = sprite.data[src];
      out.data[off + 1] = sprite.data[src + 1];
      out.data[off + 2] = sprite.data[src + 2];
      out.data[off + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
}
