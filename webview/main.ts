/// <reference lib="dom" />

import { MapboxOverlay } from "@deck.gl/mapbox";
import { COGLayer } from "@developmentseed/deck.gl-geotiff";
import { DecoderPool } from "@developmentseed/geotiff";
import {
  getColormapLUT,
  COLORMAP_NAMES,
  drawColormapPreview,
} from "./colormaps";

// Workerless decoder pool — falls back to main-thread decoding.
// Required because VS Code webview sandbox blocks Worker construction.
const mainThreadPool = new DecoderPool({ size: 0 });

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
let bandCount = 0;
let nodataValue: number | null = null;
let bandScales: number[] = [];
let bandOffsets: number[] = [];
let bandNames: string[] = [];
let scalingActive = false; // cached result of hasScaling(), set once at load

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
    ["https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png"],
    "\u00a9 OpenStreetMap contributors \u00a9 CARTO"
  ),
  satellite: makeRasterStyle(
    [
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    ],
    "\u00a9 Esri"
  ),
};

// ---------------------------------------------------------------------------
// Pixel helpers (used in hot render loop — keep lean)
// ---------------------------------------------------------------------------

function isNodata(v: number, nodata: number | null): boolean {
  return v === nodata || Number.isNaN(v);
}

/** Normalize a value to 0–255 and clamp */
function toU8(val: number, vMin: number, invRange: number): number {
  const n = (val - vMin) * invRange * 255;
  return n < 0 ? 0 : n > 255 ? 255 : (n + 0.5) | 0; // fast round via bitwise
}

// ---------------------------------------------------------------------------
// GeoTIFF metadata handler
// ---------------------------------------------------------------------------

function handleGeoTIFFLoad(tiff: any, opts: any): void {
  if (geotiffObj) return; // already loaded
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
  scalingActive =
    bandScales.length > 0 &&
    (bandScales.some((s: number) => s !== 1) ||
      bandOffsets.some((o: number) => o !== 0));

  // Extract band descriptions from GDALMetadata XML
  bandNames = [];
  try {
    const rawXml: string | null = tiff.cachedTags?.gdalMetadata ?? null;
    if (rawXml) {
      const doc = new DOMParser().parseFromString(rawXml, "text/xml");
      const items = doc.querySelectorAll('Item[name="DESCRIPTION"]');
      if (items.length > 0) {
        const names = new Array(bandCount).fill("");
        items.forEach((item) => {
          const sample = item.getAttribute("sample");
          if (sample != null) {
            names[parseInt(sample, 10)] = item.textContent ?? "";
          }
        });
        bandNames = names;
      }
    }
  } catch {
    // ignore parse errors
  }

  console.log("[RasterEye] onGeoTIFFLoad:", {
    bands: bandCount,
    bandNames,
    nodata: nodataValue,
    scaling: scalingActive,
    isTiled: tiff.isTiled,
    overviews: tiff.overviews?.length ?? 0,
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

  // Default to single band
  state.renderMode = "singleband";
  (document.getElementById("mode-select") as HTMLSelectElement).value =
    "singleband";

  populateBandSelectors(bandCount);
  updateControlVisibility();
  showLoading(false);

  // Re-render with metadata-aware settings
  updateLayer();
}

// ---------------------------------------------------------------------------
// Scaling & range helpers
// ---------------------------------------------------------------------------

function dnToScaled(dn: number, bandIdx: number): number {
  const scale = bandScales[bandIdx] ?? 1;
  const offset = bandOffsets[bandIdx] ?? 0;
  return dn * scale + offset;
}

function setRange(min: number, max: number): void {
  state.valueMin = min;
  state.valueMax = max;
  const minEl = document.getElementById("min-value") as HTMLInputElement;
  const maxEl = document.getElementById("max-value") as HTMLInputElement;
  minEl.value = formatNum(min);
  maxEl.value = formatNum(max);
  // Step = 5% of range
  const step = Math.abs(max - min) / 20 || 0.01;
  const stepStr = step < 1 ? step.toPrecision(2) : String(Math.round(step));
  minEl.step = stepStr;
  maxEl.step = stepStr;
  const label = scalingActive ? "Scaled range" : "Display range";
  document.getElementById("data-range-info")!.textContent =
    `${label}: ${formatNum(min)} \u2192 ${formatNum(max)}`;
}

function updateDefaultRange(tiff: any): void {
  const bps = tiff.cachedTags?.bitsPerSample?.[0] ?? 8;
  const sf = tiff.cachedTags?.sampleFormat;
  let fallbackMin = 0;
  let fallbackMax = 255;
  if (sf === 3 || sf === "IEEE floating point") {
    fallbackMax = 1;
  } else if (bps <= 16 && bps > 8) {
    fallbackMax =
      sf === 2 || sf === "Twos complement signed integer" ? 32767 : 10000;
  }
  if (scalingActive) {
    fallbackMin = dnToScaled(fallbackMin, 0);
    fallbackMax = dnToScaled(fallbackMax, 0);
    if (fallbackMin > fallbackMax) {
      [fallbackMin, fallbackMax] = [fallbackMax, fallbackMin];
    }
  }
  setRange(fallbackMin, fallbackMax);
  computePercentilesForBand(state.singleBand);
}

// ---------------------------------------------------------------------------
// Percentile computation (async, uses cached tile data)
// ---------------------------------------------------------------------------

let cachedTileData: any = null;

async function computePercentilesForBand(bandIdx: number): Promise<void> {
  if (!geotiffObj) return;

  try {
    if (!cachedTileData) {
      const tile = await geotiffObj.fetchTile(0, 0, { pool: mainThreadPool });
      cachedTileData = tile.array.data;
    }

    const nodata = geotiffObj.nodata;
    const pixelCount = cachedTileData.length / bandCount;
    const bi = Math.min(bandIdx, bandCount - 1);

    const values: number[] = [];
    for (let i = 0; i < pixelCount; i++) {
      const dn = cachedTileData[i * bandCount + bi];
      if (isNodata(dn, nodata)) continue;
      values.push(scalingActive ? dnToScaled(dn, bi) : dn);
    }

    if (values.length < 10) return;

    values.sort((a, b) => a - b);
    const p2 = values[Math.floor(values.length * 0.02)];
    const p98 = values[Math.floor(values.length * 0.98)];

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

  const baseProps: any = {
    id: "cog-layer",
    geotiff: src,
    opacity: state.opacity,
    pool: mainThreadPool,
    onGeoTIFFLoad: handleGeoTIFFLoad,
    onError: (err: any) => {
      console.error("[RasterEye] COGLayer error:", err);
    },
  };

  // Custom CPU pipeline — handles >4 bands, colormaps, band selection.
  // State is read at render time so changes after onGeoTIFFLoad take effect.

  baseProps.getTileData = async (image: any, options: any) => {
    try {
      const tile = await image.fetchTile(options.x, options.y, {
        signal: options.signal,
      });
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

    const curMode = state.renderMode;
    const vMin = state.valueMin;
    const vMax = state.valueMax;
    const invRange = 1 / (vMax - vMin || 1);
    const nodata = nodataValue;
    const scaled = scalingActive;

    const pixelCount = width * height;
    const dataSpp = Math.max(1, Math.round(data.length / pixelCount));
    const imgData = new ImageData(width, height);
    const rgba = imgData.data;

    if (curMode === "singleband") {
      const lut = getColormapLUT(state.colormap);
      const bi = Math.min(state.singleBand, dataSpp - 1);
      // Hoist scale/offset for this band outside the loop
      const scale = scaled ? (bandScales[bi] ?? 1) : 1;
      const offset = scaled ? (bandOffsets[bi] ?? 0) : 0;

      for (let i = 0; i < pixelCount; i++) {
        const dn = data[i * dataSpp + bi];
        if (dn === nodata || dn !== dn) { rgba[i * 4 + 3] = 0; continue; }
        const val = dn * scale + offset;
        const n = toU8(val, vMin, invRange);
        rgba[i * 4] = lut[n * 4];
        rgba[i * 4 + 1] = lut[n * 4 + 1];
        rgba[i * 4 + 2] = lut[n * 4 + 2];
        rgba[i * 4 + 3] = 255;
      }
    } else {
      // 3-Band Composite — hoist per-band scale/offset
      const ri = Math.min(state.bandR, dataSpp - 1);
      const gi = Math.min(state.bandG, dataSpp - 1);
      const bi = Math.min(state.bandB, dataSpp - 1);
      const sR = scaled ? (bandScales[ri] ?? 1) : 1;
      const oR = scaled ? (bandOffsets[ri] ?? 0) : 0;
      const sG = scaled ? (bandScales[gi] ?? 1) : 1;
      const oG = scaled ? (bandOffsets[gi] ?? 0) : 0;
      const sB = scaled ? (bandScales[bi] ?? 1) : 1;
      const oB = scaled ? (bandOffsets[bi] ?? 0) : 0;

      for (let i = 0; i < pixelCount; i++) {
        const dnR = data[i * dataSpp + ri];
        if (dnR === nodata || dnR !== dnR) { rgba[i * 4 + 3] = 0; continue; }
        rgba[i * 4] = toU8(dnR * sR + oR, vMin, invRange);
        rgba[i * 4 + 1] = toU8(data[i * dataSpp + gi] * sG + oG, vMin, invRange);
        rgba[i * 4 + 2] = toU8(data[i * dataSpp + bi] * sB + oB, vMin, invRange);
        rgba[i * 4 + 3] = 255;
      }
    }

    return imgData;
  };

  overlay.setProps({ layers: [new COGLayer(baseProps)] });
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
  // Range is always visible
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
    const pct = Math.round(state.opacity * 100);
    opLabel.textContent = `${pct}%`;
    opSlider.style.setProperty("--pct", `${pct}%`);
    updateLayer();
  });

  document.getElementById("mode-select")!.addEventListener("change", (e) => {
    state.renderMode = (e.target as HTMLSelectElement).value as
      | "singleband"
      | "3band";
    updateControlVisibility();
    // Recompute percentiles for the active band
    const activeBand =
      state.renderMode === "3band" ? state.bandR : state.singleBand;
    computePercentilesForBand(activeBand);
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
      // Recompute percentiles using the R band
      if (key === "bandR") {
        computePercentilesForBand(state.bandR);
      } else {
        updateLayer();
      }
    });
  }

  document
    .getElementById("band-single")!
    .addEventListener("change", (e) => {
      state.singleBand = parseInt(
        (e.target as HTMLSelectElement).value,
        10
      );
      computePercentilesForBand(state.singleBand);
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
  // File URL from injected globals (webview) or query params (browser)
  const win = window as any;
  const params = new URLSearchParams(window.location.search);
  const paramFile = win.__RASTEREYE_FILE_URL__ || params.get("file");
  const paramName =
    win.__RASTEREYE_FILENAME__ ||
    params.get("name") ||
    paramFile?.split("/").pop() ||
    "GeoTIFF";

  if (paramFile) {
    fileUrl = paramFile;
    const el = document.getElementById("filename");
    if (el) {
      el.textContent = paramName;
      el.title = paramName;
    }
    if (!win.__RASTEREYE_FILE_URL__) {
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
    if (fileUrl) {
      hideError();
      updateLayer();
    }
  });
}

document.addEventListener("DOMContentLoaded", init);
