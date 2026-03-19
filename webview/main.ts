/// <reference lib="dom" />

import { MapboxOverlay } from "@deck.gl/mapbox";
import { COGLayer } from "@developmentseed/deck.gl-geotiff";
import { DecoderPool } from "@developmentseed/geotiff";
import { CreateTexture } from "@developmentseed/deck.gl-raster/gpu-modules";
import {
  getColormapLUT,
  COLORMAP_NAMES,
  drawColormapPreview,
} from "./colormaps";

const mainThreadPool = new DecoderPool({ size: 0 });

// ---------------------------------------------------------------------------
// Types & state
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
let scalingActive = false;
let gpuDevice: any = null;

// Layer version — bumped only when tile data must be re-fetched (band change).
// Render-only changes (colormap, range, opacity) reuse cached tiles.
let layerVersion = 0;
let currentLayerId = "cog-layer-0";

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
// Helpers
// ---------------------------------------------------------------------------

function isNodata(v: number, nodata: number | null): boolean {
  return v === nodata || Number.isNaN(v);
}

function dnToScaled(dn: number, bandIdx: number): number {
  return dn * (bandScales[bandIdx] ?? 1) + (bandOffsets[bandIdx] ?? 0);
}

// ---------------------------------------------------------------------------
// GeoTIFF metadata handler
// ---------------------------------------------------------------------------

function handleGeoTIFFLoad(tiff: any, opts: any): void {
  if (geotiffObj) return;
  geotiffObj = tiff;

  bandCount = tiff.count ?? 1;
  nodataValue = tiff.nodata ?? null;

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
    // ignore
  }

  console.log("[RasterEye] onGeoTIFFLoad:", {
    bands: bandCount,
    bandNames,
    nodata: nodataValue,
    scaling: scalingActive,
    isTiled: tiff.isTiled,
    overviews: tiff.overviews?.length ?? 0,
  });

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

  updateDefaultRange(tiff);

  state.renderMode = "singleband";
  (document.getElementById("mode-select") as HTMLSelectElement).value =
    "singleband";

  populateBandSelectors(bandCount);
  updateControlVisibility();
  showLoading(false);
  rebuildLayer();
}

// ---------------------------------------------------------------------------
// Range helpers
// ---------------------------------------------------------------------------

function setRange(min: number, max: number): void {
  state.valueMin = min;
  state.valueMax = max;
  const minEl = document.getElementById("min-value") as HTMLInputElement;
  const maxEl = document.getElementById("max-value") as HTMLInputElement;
  minEl.value = formatNum(min);
  maxEl.value = formatNum(max);
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
// Percentile computation
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
    rerenderLayer(); // range changed — raw data already cached
  } catch (err) {
    console.warn("[RasterEye] Could not compute percentiles:", err);
  }
}

// ---------------------------------------------------------------------------
// Tile rendering — builds RGBA texture from raw tile data + current state.
// Called by COGLayer's renderTile; reads state at render time so colormap,
// range, and mode changes take effect without re-fetching tiles.
// ---------------------------------------------------------------------------

function buildTexture(
  device: any,
  data: any,
  w: number,
  h: number,
  spp: number
): any {
  const pixelCount = w * h;
  const nodata = nodataValue;
  const scaled = scalingActive;
  const vMin = state.valueMin;
  const vMax = state.valueMax;
  const range = vMax - vMin || 1;
  const out = new Uint8Array(pixelCount * 4);

  if (state.renderMode === "singleband") {
    const bi = Math.min(state.singleBand, spp - 1);
    const bScale = scaled ? (bandScales[bi] ?? 1) : 1;
    const bOffset = scaled ? (bandOffsets[bi] ?? 0) : 0;
    const lut = getColormapLUT(state.colormap);

    for (let i = 0; i < pixelCount; i++) {
      const dn = data[i * spp + bi];
      if (dn === nodata || dn !== dn) {
        out[i * 4 + 3] = 0;
        continue;
      }
      const frac = ((dn * bScale + bOffset - vMin) / range) * 255;
      const n = frac < 0 ? 0 : frac > 255 ? 255 : (frac + 0.5) | 0;
      out[i * 4] = lut[n * 4];
      out[i * 4 + 1] = lut[n * 4 + 1];
      out[i * 4 + 2] = lut[n * 4 + 2];
      out[i * 4 + 3] = 255;
    }
  } else {
    const ri = Math.min(state.bandR, spp - 1);
    const gi = Math.min(state.bandG, spp - 1);
    const bi = Math.min(state.bandB, spp - 1);
    const sR = scaled ? (bandScales[ri] ?? 1) : 1;
    const oR = scaled ? (bandOffsets[ri] ?? 0) : 0;
    const sG = scaled ? (bandScales[gi] ?? 1) : 1;
    const oG = scaled ? (bandOffsets[gi] ?? 0) : 0;
    const sB = scaled ? (bandScales[bi] ?? 1) : 1;
    const oB = scaled ? (bandOffsets[bi] ?? 0) : 0;

    for (let i = 0; i < pixelCount; i++) {
      const dnR = data[i * spp + ri];
      if (dnR === nodata || dnR !== dnR) {
        out[i * 4 + 3] = 0;
        continue;
      }
      const vr = ((dnR * sR + oR - vMin) / range) * 255;
      const vg = ((data[i * spp + gi] * sG + oG - vMin) / range) * 255;
      const vb = ((data[i * spp + bi] * sB + oB - vMin) / range) * 255;
      out[i * 4] = vr < 0 ? 0 : vr > 255 ? 255 : (vr + 0.5) | 0;
      out[i * 4 + 1] = vg < 0 ? 0 : vg > 255 ? 255 : (vg + 0.5) | 0;
      out[i * 4 + 2] = vb < 0 ? 0 : vb > 255 ? 255 : (vb + 0.5) | 0;
      out[i * 4 + 3] = 255;
    }
  }

  return device.createTexture({
    data: out,
    width: w,
    height: h,
    format: "rgba8unorm",
  });
}

// ---------------------------------------------------------------------------
// Layer management
//
// rebuildLayer() — creates a new COGLayer (new ID, re-fetches tiles).
//   Called when: band selection changes, mode changes, file opens.
//
// rerenderLayer() — creates a COGLayer with same ID (reuses tile cache).
//   Called when: colormap, range, opacity changes.
// ---------------------------------------------------------------------------

function makeCOGLayerProps(layerId: string): any {
  return {
    id: layerId,
    geotiff: geotiffObj || fileUrl,
    opacity: state.opacity,
    pool: mainThreadPool,
    onGeoTIFFLoad: handleGeoTIFFLoad,
    onError: (err: any) => {
      console.error("[RasterEye] COGLayer error:", err);
    },

    // getTileData: fetch raw tile, cache the interleaved data for renderTile.
    // This runs once per tile per layer version.
    getTileData: async (image: any, options: any) => {
      const device = options.device;
      if (!gpuDevice) gpuDevice = device;

      try {
        const tile = await image.fetchTile(options.x, options.y, {
          signal: options.signal,
        });
        const data = tile.array.data;
        const w = tile.array.width;
        const h = tile.array.height;
        const spp = Math.max(1, Math.round(data.length / (w * h)));

        // Return raw data + a pre-built texture for the initial render
        return {
          width: w,
          height: h,
          data, // raw interleaved band data (cached by TileLayer)
          spp,
          texture: buildTexture(device, data, w, h, spp),
        };
      } catch (err: any) {
        console.error("[RasterEye] fetchTile FAILED:", err);
        throw err;
      }
    },

    // renderTile: builds GPU pipeline from cached tile data.
    // Reads current state so colormap/range/mode changes take effect instantly.
    renderTile: (td: any) => {
      if (!td.data || !gpuDevice) return new ImageData(1, 1);

      // Rebuild texture from raw data with current state
      const texture = buildTexture(gpuDevice, td.data, td.width, td.height, td.spp);
      return [
        { module: CreateTexture, props: { textureName: texture } },
      ];
    },
  };
}

function rebuildLayer(): void {
  if (!fileUrl && !geotiffObj) return;
  layerVersion++;
  currentLayerId = `cog-layer-${layerVersion}`;
  overlay.setProps({
    layers: [new COGLayer(makeCOGLayerProps(currentLayerId))],
  });
}

function rerenderLayer(): void {
  if (!fileUrl && !geotiffObj) return;
  // Same ID → TileLayer reuses cached tiles, only reruns renderTile
  overlay.setProps({
    layers: [new COGLayer(makeCOGLayerProps(currentLayerId))],
  });
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
      map.once("styledata", () => rerenderLayer());
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
    rerenderLayer(); // opacity only — no re-fetch
  });

  document.getElementById("mode-select")!.addEventListener("change", (e) => {
    state.renderMode = (e.target as HTMLSelectElement).value as
      | "singleband"
      | "3band";
    updateControlVisibility();
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
      if (key === "bandR") {
        computePercentilesForBand(state.bandR);
      } else {
        rerenderLayer(); // G/B band change — reuse cached data
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
      rerenderLayer(); // colormap only — no re-fetch
    });

  const minInput = document.getElementById("min-value") as HTMLInputElement;
  const maxInput = document.getElementById("max-value") as HTMLInputElement;
  const onRangeChange = () => {
    state.valueMin = parseFloat(minInput.value) || 0;
    state.valueMax = parseFloat(maxInput.value) || 1;
    rerenderLayer(); // range only — no re-fetch
  };
  minInput.addEventListener("change", onRangeChange);
  maxInput.addEventListener("change", onRangeChange);

  populateColormapSelector();
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

function init(): void {
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
    attributionControl: false,
  });

  overlay = new MapboxOverlay({
    interleaved: true,
    layers: [],
  });

  map.addControl(overlay);
  map.addControl(new maplibregl.NavigationControl(), "top-left");
  map.addControl(new maplibregl.AttributionControl({ compact: true }));

  setupControls();

  map.once("load", () => {
    const attrib = document.querySelector(".maplibregl-ctrl-attrib");
    if (attrib) attrib.classList.remove("maplibregl-compact-show");
  });

  map.on("load", () => {
    if (fileUrl) {
      hideError();
      rebuildLayer();
    }
  });
}

document.addEventListener("DOMContentLoaded", init);
