/// UI setup: band selectors, colormap selector, control visibility.

import { state, bandNames } from "./state";
import { COLORMAP_NAMES, drawColormapPreview } from "./colormaps";
import { colormapIndex, getColormapSprite, getPalette, PALETTE } from "./gpu-pipeline";

export function populateBandSelectors(count: number): void {
  for (const id of ["band-r", "band-g", "band-b", "band-single"]) {
    const sel = document.getElementById(id) as HTMLSelectElement;
    if (!sel) continue;
    sel.innerHTML = "";
    for (let b = 0; b < count; b++) {
      const opt = document.createElement("option");
      opt.value = String(b);
      const name = bandNames[b];
      opt.textContent = name ? `${b + 1}: ${name}` : `Band ${b + 1}`;
      sel.appendChild(opt);
    }
  }
  // Reset the selection to the first bands, clamped to the band count so
  // the selectors always show the bands that are actually drawn (a 2-band
  // file cannot default its blue channel to band 3).
  const last = Math.max(0, count - 1);
  state.singleBand = 0;
  state.bandR = 0;
  state.bandG = Math.min(1, last);
  state.bandB = Math.min(2, last);
  const set = (id: string, v: number) => {
    const sel = document.getElementById(id) as HTMLSelectElement | null;
    if (sel) sel.value = String(v);
  };
  set("band-single", state.singleBand);
  set("band-r", state.bandR);
  set("band-g", state.bandG);
  set("band-b", state.bandB);
}

export function populateColormapSelector(): void {
  const sel = document.getElementById("colormap-select") as HTMLSelectElement;
  for (const name of COLORMAP_NAMES) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name.charAt(0).toUpperCase() + name.slice(1);
    sel.appendChild(opt);
  }
  sel.value = state.colormap;
  updateColormapPreview();
}

export function updateColormapPreview(): void {
  const canvas = document.getElementById(
    "colormap-preview"
  ) as HTMLCanvasElement;
  if (!canvas) return;
  const name = state.colormap;
  const reversed = state.colormapReversed;
  const palette = getPalette();
  if (name === PALETTE && palette) {
    drawColormapPreview(canvas, { data: palette, width: 256 }, 0, false);
    return;
  }
  getColormapSprite().then((sprite) => {
    // Skip a stale draw if the selection changed while the sprite decoded.
    if (name !== state.colormap || reversed !== state.colormapReversed) return;
    drawColormapPreview(canvas, sprite, colormapIndex(name), reversed);
  }).catch((err) => console.warn("[RasterEye] Colormap preview failed:", err));
}

/// Offer the file's own colour table as the first colormap and select it.
export function enablePaletteColormap(): void {
  const sel = document.getElementById("colormap-select") as HTMLSelectElement;
  const opt = document.createElement("option");
  opt.value = PALETTE;
  opt.textContent = "File palette";
  sel.insertBefore(opt, sel.firstChild);
  sel.value = PALETTE;
  state.colormap = PALETTE;
  updateColormapPreview();
}

export function updateControlVisibility(): void {
  const is3band = state.renderMode === "3band";
  const isSingleband = state.renderMode === "singleband";

  document
    .getElementById("falsecolor-group")!
    .classList.toggle("hidden", !is3band);
  document
    .getElementById("singleband-group")!
    .classList.toggle("hidden", !isSingleband);
  document
    .getElementById("colormap-group")!
    .classList.toggle("hidden", !isSingleband);

  // A palette lookup has no stretch and no direction.
  const paletteActive = isSingleband && state.colormap === PALETTE;
  document.getElementById("range-group")!.classList.toggle("hidden", paletteActive);
  document.getElementById("colormap-reversed")!.closest("label")!
    .classList.toggle("hidden", paletteActive);
}
