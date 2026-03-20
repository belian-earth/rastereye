/// UI setup: band selectors, colormap selector, control visibility.

import { state, bandNames, bandCount } from "./state";
import { COLORMAP_NAMES, drawColormapPreview } from "./colormaps";

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
  const selR = document.getElementById("band-r") as HTMLSelectElement;
  const selG = document.getElementById("band-g") as HTMLSelectElement;
  const selB = document.getElementById("band-b") as HTMLSelectElement;
  if (selR) selR.value = "0";
  if (selG && count > 1) selG.value = "1";
  if (selB && count > 2) selB.value = "2";
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
  if (canvas) drawColormapPreview(canvas, state.colormap);
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
}
