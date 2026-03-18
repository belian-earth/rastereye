/// <reference lib="dom" />

import { MapboxOverlay } from "@deck.gl/mapbox";
import { COGLayer } from "@developmentseed/deck.gl-geotiff";
import {
  getColormapLUT,
  COLORMAP_NAMES,
  drawColormapPreview,
} from "./colormaps";

// ---------------------------------------------------------------------------
// Globals & types
// ---------------------------------------------------------------------------

declare const maplibregl: any;

interface ViewerState {
  basemap: string;
  opacity: number;
  renderMode: "singleband" | "3band";
  bandR: number;
  bandG: number;
  bandB: number;
  singleBand: number;
  colormap: string;
  valueMin: number;
  valueMax: number;
}

const state: ViewerState = {
  basemap: "light",
  opacity: 1.0,
  renderMode: "singleband",
  bandR: 0,
  bandG: 1,
  bandB: 2,
  singleBand: 0,
  colormap: "viridis",
  valueMin: 0,
  valueMax: 255,
};

let map: any;
let overlay: any;
let fileUrl = "";
let geotiffObj: any = null;
let metadataLoaded = false;
let bandCount = 0;
let nodataValue: number | null = null;
let bandScales: number[] = [];  // per-band scale factors (default 1)
let bandOffsets: number[] = []; // per-band offsets (default 0)

// ---------------------------------------------------------------------------
// Basemap styles
// ---------------------------------------------------------------------------

function makeRasterStyle(tiles: string[], attribution: string): any {
  return {
    version: 8,
    sources: {
      basemap: {
        type: "raster",
        tiles,
        tileSize: 256,
        maxzoom: 19,
        attribution,
      },
    },
    layers: [{ id: "basemap", type: "raster", source: "basemap" }],
  };
}

const BASEMAP_STYLES: Record<string, any> = {
  light: makeRasterStyle(
    ["https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png"],
    "\u00a9 OpenStreetMap contributors \u00a9 CARTO"
  ),
  dark: makeRasterStyle(
    ["https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png"],
    "\u00a9 OpenStreetMap contributors \u00a9 CARTO"
  ),
  osm: makeRasterStyle(
    ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
    "\u00a9 OpenStreetMap contributors"
  ),
  satellite: makeRasterStyle(
    [
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    ],
    "\u00a9 Esri"
  ),
};

// ---------------------------------------------------------------------------
// GeoTIFF metadata handler
// ---------------------------------------------------------------------------

function handleGeoTIFFLoad(tiff: any, opts: any): void {
  if (metadataLoaded) return;
  metadataLoaded = true;
  geotiffObj = tiff;

  bandCount = tiff.count ?? 1;
  nodataValue = tiff.nodata ?? null;

  // Read per-band scale/offset (scaled_value = DN * scale + offset)
  try {
    bandScales = tiff.scales ?? [];
    bandOffsets = tiff.offsets ?? [];
  } catch {
    bandScales = [];
    bandOffsets = [];
  }

  console.log("[RasterEye] onGeoTIFFLoad:", {
    bands: bandCount,
    nodata: nodataValue,
    scales: bandScales,
    offsets: bandOffsets,
    isTiled: tiff.isTiled,
    tileSize: tiff.isTiled ? `${tiff.tileWidth}x${tiff.tileHeight}` : "N/A",
    overviews: tiff.overviews?.length ?? 0,
    crs: tiff.crs,
    bbox: tiff.bbox,
  });

  // Fit map to bounds
  const bounds = opts.geographicBounds;
  try {
    if (bounds) {
      let west: number, south: number, east: number, north: number;
      if (Array.isArray(bounds)) {
        [west, south, east, north] = bounds;
      } else {
        ({ west, south, east, north } = bounds);
      }
      map.fitBounds(
        [
          [west, south],
          [east, north],
        ],
        { padding: 50, maxZoom: 18 }
      );
    }
  } catch (err) {
    console.warn("[RasterEye] Failed to fit bounds:", err);
  }

  // Value range
  updateDefaultRange(tiff);

  // Default to single band — user can switch to false color for composites
  state.renderMode = "singleband";
  (document.getElementById("mode-select") as HTMLSelectElement).value =
    "singleband";

  populateBandSelectors(bandCount);
  updateControlVisibility();
  showLoading(false);

  // Re-render with metadata-aware settings
  updateLayer();
}

/** Convert a raw DN to a scaled value using per-band scale/offset */
function dnToScaled(dn: number, bandIdx: number): number {
  const scale = bandScales[bandIdx] ?? 1;
  const offset = bandOffsets[bandIdx] ?? 0;
  return dn * scale + offset;
}

function hasScaling(): boolean {
  return bandScales.length > 0 &&
    (bandScales.some((s) => s !== 1) || bandOffsets.some((o) => o !== 0));
}

function setRange(min: number, max: number): void {
  state.valueMin = min;
  state.valueMax = max;
  (document.getElementById("min-value") as HTMLInputElement).value =
    formatNum(min);
  (document.getElementById("max-value") as HTMLInputElement).value =
    formatNum(max);
  const label = hasScaling() ? "Scaled range" : "Display range";
  document.getElementById("data-range-info")!.textContent =
    `${label}: ${formatNum(min)} \u2013 ${formatNum(max)}`;
}

function updateDefaultRange(tiff: any): void {
  // Set a rough fallback immediately (will be replaced by percentiles)
  const bps = tiff.cachedTags?.bitsPerSample?.[0] ?? 8;
  const sf = tiff.cachedTags?.sampleFormat;
  let fallbackMin = 0;
  let fallbackMax = 255;
  if (sf === 3 || sf === "IEEE floating point") {
    fallbackMax = 1;
  } else if (bps <= 16 && bps > 8) {
    fallbackMax = sf === 2 || sf === "Twos complement signed integer" ? 32767 : 10000;
  }
  // Apply scaling to fallback
  if (hasScaling()) {
    fallbackMin = dnToScaled(fallbackMin, 0);
    fallbackMax = dnToScaled(fallbackMax, 0);
    if (fallbackMin > fallbackMax) {
      [fallbackMin, fallbackMax] = [fallbackMax, fallbackMin];
    }
  }
  setRange(fallbackMin, fallbackMax);

  // Compute 2nd/98th percentile from the first tile (async)
  computePercentilesFromTile(tiff);
}

async function computePercentilesFromTile(tiff: any): Promise<void> {
  try {
    const tile = await tiff.fetchTile(0, 0);
    const data = tile.array.data;
    const spp = tiff.count ?? 1;
    const pixelCount = data.length / spp;
    const nodata = tiff.nodata;
    const scaled = hasScaling();

    // Extract band 0 values (scaled if available), excluding nodata/NaN
    const values: number[] = [];
    for (let i = 0; i < pixelCount; i++) {
      const dn = data[i * spp]; // first band
      if (dn === nodata || dn !== dn) continue;
      values.push(scaled ? dnToScaled(dn, 0) : dn);
    }

    if (values.length < 10) return;

    values.sort((a, b) => a - b);
    const p2 = values[Math.floor(values.length * 0.02)];
    const p98 = values[Math.floor(values.length * 0.98)];

    console.log(
      `[RasterEye] Percentiles: p2=${p2}, p98=${p98} (${values.length} pixels, scaled=${scaled})`
    );
    setRange(p2, p98);
    updateLayer();
  } catch (err) {
    console.warn("[RasterEye] Could not compute percentiles:", err);
  }
}

// ---------------------------------------------------------------------------
// Layer creation
// ---------------------------------------------------------------------------

function updateLayer(): void {
  if (!fileUrl && !geotiffObj) return;

  const src = geotiffObj || fileUrl;
  const mode = state.renderMode;
  console.log("[RasterEye] updateLayer, mode:", mode);

  const baseProps: any = {
    id: "cog-layer",
    geotiff: src,
    opacity: state.opacity,
    onGeoTIFFLoad: handleGeoTIFFLoad,
    onError: (err: any) => {
      console.error("[RasterEye] COGLayer error:", err);
    },
  };

  // Always use custom CPU pipeline — the default GPU pipeline can't handle
  // >4 bands, and our CPU path gives us colormap/band selection control.
  // NOTE: read state at render time (in renderTile), not here, because
  // onGeoTIFFLoad updates the range/nodata after the first updateLayer call.

  baseProps.getTileData = async (image: any, options: any) => {
    console.log("[RasterEye] getTileData tile:", options.x, options.y);
    try {
      // Try without pool first (main thread decoding) to avoid Worker issues
      const tile = await image.fetchTile(options.x, options.y, {
        signal: options.signal,
      });
      console.log("[RasterEye] tile fetched:", tile.array.width, "x", tile.array.height,
        "bytes:", tile.array.data.length);
      return {
        width: tile.array.width,
        height: tile.array.height,
        data: tile.array.data,
      };
    } catch (err: any) {
      console.error("[RasterEye] fetchTile FAILED:", err);
      throw err;
    }
  };

  baseProps.renderTile = (
    td: { width: number; height: number; data: any }
  ) => {
    const { width, height, data } = td;
    if (!width || !height || !data) return new ImageData(1, 1);

    // Read current state at render time (not from closure)
    const curMode = state.renderMode;
    const vMin = state.valueMin;
    const vMax = state.valueMax;
    const range = vMax - vMin || 1;
    const nodata = nodataValue;

    const pixelCount = width * height;
    const dataSpp = Math.max(1, Math.round(data.length / pixelCount));
    const imgData = new ImageData(width, height);
    const rgba = imgData.data;

    const scaled = hasScaling();

    if (curMode === "singleband") {
      const lut = getColormapLUT(state.colormap);
      const bi = Math.min(state.singleBand, dataSpp - 1);
      for (let i = 0; i < pixelCount; i++) {
        const dn = data[i * dataSpp + bi];
        if (dn === nodata || dn !== dn) { rgba[i * 4 + 3] = 0; continue; }
        const val = scaled ? dnToScaled(dn, bi) : dn;
        const n = Math.max(0, Math.min(255, Math.floor(((val - vMin) / range) * 255)));
        rgba[i * 4] = lut[n * 4];
        rgba[i * 4 + 1] = lut[n * 4 + 1];
        rgba[i * 4 + 2] = lut[n * 4 + 2];
        rgba[i * 4 + 3] = 255;
      }
    } else {
      // 3-Band Composite
      const ri = Math.min(state.bandR, dataSpp - 1);
      const gi = Math.min(state.bandG, dataSpp - 1);
      const bi = Math.min(state.bandB, dataSpp - 1);
      for (let i = 0; i < pixelCount; i++) {
        const dnR = data[i * dataSpp + ri];
        const dnG = data[i * dataSpp + gi];
        const dnB = data[i * dataSpp + bi];
        if (dnR === nodata || dnR !== dnR) { rgba[i * 4 + 3] = 0; continue; }
        const r = scaled ? dnToScaled(dnR, ri) : dnR;
        const g = scaled ? dnToScaled(dnG, gi) : dnG;
        const b = scaled ? dnToScaled(dnB, bi) : dnB;
        rgba[i * 4] = clampByte(((r - vMin) / range) * 255);
        rgba[i * 4 + 1] = clampByte(((g - vMin) / range) * 255);
        rgba[i * 4 + 2] = clampByte(((b - vMin) / range) * 255);
        rgba[i * 4 + 3] = 255;
      }
    }

    console.log("[RasterEye] renderTile:", width, "x", height, "mode:", curMode, "range:", vMin, "-", vMax);
    return imgData;
  };

  const layer = new COGLayer(baseProps);
  overlay.setProps({ layers: [layer] });
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

function formatNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(4);
}

function showLoading(show: boolean): void {
  document
    .getElementById("loading-overlay")!
    .classList.toggle("hidden", !show);
}

function showError(msg: string): void {
  document.getElementById("error-box")!.textContent = msg;
  document.getElementById("error-overlay")!.classList.remove("hidden");
  showLoading(false);
}

function hideError(): void {
  document.getElementById("error-overlay")!.classList.add("hidden");
}

function populateBandSelectors(count: number): void {
  const ids = ["band-r", "band-g", "band-b", "band-single"];
  for (const id of ids) {
    const sel = document.getElementById(id) as HTMLSelectElement;
    if (!sel) continue;
    sel.innerHTML = "";
    for (let b = 0; b < count; b++) {
      const opt = document.createElement("option");
      opt.value = String(b);
      opt.textContent = `Band ${b + 1}`;
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

function populateColormapSelector(): void {
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

function updateColormapPreview(): void {
  const canvas = document.getElementById(
    "colormap-preview"
  ) as HTMLCanvasElement;
  if (canvas) drawColormapPreview(canvas, state.colormap);
}

function updateControlVisibility(): void {
  const mode = state.renderMode;
  const is3band = mode === "3band";
  const isSingleband = mode === "singleband";

  document
    .getElementById("falsecolor-group")!
    .classList.toggle("hidden", !is3band);
  document
    .getElementById("singleband-group")!
    .classList.toggle("hidden", !isSingleband);
  document
    .getElementById("colormap-group")!
    .classList.toggle("hidden", !isSingleband);
  document
    .getElementById("range-group")!
    .classList.toggle("hidden", false);
}

// ---------------------------------------------------------------------------
// Control event setup
// ---------------------------------------------------------------------------

function setupControls(): void {
  document
    .getElementById("basemap-select")!
    .addEventListener("change", (e) => {
      state.basemap = (e.target as HTMLSelectElement).value;
      map.setStyle(BASEMAP_STYLES[state.basemap]);
      map.once("styledata", () => updateLayer());
    });

  const opSlider = document.getElementById(
    "opacity-slider"
  ) as HTMLInputElement;
  const opLabel = document.getElementById("opacity-value")!;
  opSlider.addEventListener("input", () => {
    state.opacity = parseFloat(opSlider.value);
    opLabel.textContent = `${Math.round(state.opacity * 100)}%`;
    updateLayer();
  });

  document.getElementById("mode-select")!.addEventListener("change", (e) => {
    state.renderMode = (e.target as HTMLSelectElement).value as any;
    updateControlVisibility();
    updateLayer();
  });

  for (const [id, key] of [
    ["band-r", "bandR"],
    ["band-g", "bandG"],
    ["band-b", "bandB"],
  ] as const) {
    document.getElementById(id)!.addEventListener("change", (e) => {
      (state as any)[key] = parseInt(
        (e.target as HTMLSelectElement).value,
        10
      );
      updateLayer();
    });
  }

  document
    .getElementById("band-single")!
    .addEventListener("change", (e) => {
      state.singleBand = parseInt(
        (e.target as HTMLSelectElement).value,
        10
      );
      updateLayer();
    });

  document
    .getElementById("colormap-select")!
    .addEventListener("change", (e) => {
      state.colormap = (e.target as HTMLSelectElement).value;
      updateColormapPreview();
      updateLayer();
    });

  const minInput = document.getElementById("min-value") as HTMLInputElement;
  const maxInput = document.getElementById("max-value") as HTMLInputElement;
  const onRangeChange = () => {
    state.valueMin = parseFloat(minInput.value) || 0;
    state.valueMax = parseFloat(maxInput.value) || 1;
    updateLayer();
  };
  minInput.addEventListener("change", onRangeChange);
  maxInput.addEventListener("change", onRangeChange);

  populateColormapSelector();
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

function init(): void {
  console.log("[RasterEye] init() starting");

  const params = new URLSearchParams(window.location.search);
  const paramFile = params.get("file");
  const paramName =
    params.get("name") || paramFile?.split("/").pop() || "GeoTIFF";

  if (paramFile) {
    fileUrl = paramFile;
    const el = document.getElementById("filename");
    if (el) {
      el.textContent = paramName;
      el.title = paramName;
      document.title = `RasterEye - ${paramName}`;
    }
  }

  map = new maplibregl.Map({
    container: "map",
    style: BASEMAP_STYLES[state.basemap],
    center: [0, 0],
    zoom: 2,
    attributionControl: true,
  });

  overlay = new MapboxOverlay({
    interleaved: true,
    layers: [],
  });

  map.addControl(overlay);
  map.addControl(new maplibregl.NavigationControl(), "top-left");

  setupControls();

  map.on("load", () => {
    console.log("[RasterEye] map loaded");
    if (fileUrl) {
      hideError();
      updateLayer();
    }
  });
}

document.addEventListener("DOMContentLoaded", init);
