/// <reference lib="dom" />
/// Entry point — map init, control wiring, file loading dispatch.

import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapLibreOverlay } from "@deck.gl/maplibre";
import maplibreWorkerSource from "maplibre-worker-source";

import {
  state, BASEMAP_STYLES, FALLBACK_STYLE, setMap, setOverlay, setFileUrl, map, fileUrl,
} from "./state";
import { hideError, showError, showNotice, isAbortError } from "./helpers";
import { updateColormapPreview, updateControlVisibility, populateColormapSelector } from "./ui";
import { rerenderLayer, rebuildLayer } from "./layers";
import { loadFile } from "./load";
import { updateRangeLabel } from "./range";
import { computePercentilesForBand } from "./percentiles";
import { initInspector, refreshInspector } from "./inspect";

// maplibre-gl 6 runs its worker from a separate module. The source is inlined
// by esbuild (see esbuild.mjs) and started from a blob URL, because a worker
// script cannot be fetched from the extension's resource origin in a webview.
maplibregl.setWorkerUrl(
  URL.createObjectURL(new Blob([maplibreWorkerSource], { type: "text/javascript" })),
);

// ---------------------------------------------------------------------------
// Control event setup
// ---------------------------------------------------------------------------

function setupControls(): void {
  document
    .getElementById("basemap-select")!
    .addEventListener("change", (e) => {
      state.basemap = (e.target as HTMLSelectElement).value;
      document.getElementById("notice")?.classList.add("hidden");
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
    rerenderLayer();
  });

  document.getElementById("mode-select")!.addEventListener("change", async (e) => {
    state.renderMode = (e.target as HTMLSelectElement).value as
      | "singleband"
      | "3band";
    updateControlVisibility();
    const activeBand =
      state.renderMode === "3band" ? state.bandR : state.singleBand;
    await computePercentilesForBand(activeBand);
    rebuildLayer();
    refreshInspector();
  });

  for (const [id, key] of [
    ["band-r", "bandR"],
    ["band-g", "bandG"],
    ["band-b", "bandB"],
  ] as const) {
    document.getElementById(id)!.addEventListener("change", async (e) => {
      (state as any)[key] = parseInt(
        (e.target as HTMLSelectElement).value,
        10
      );
      if (key === "bandR") {
        await computePercentilesForBand(state.bandR);
      }
      // 3-band textures are per-channel: changing any of bandR/G/B requires
      // re-fetching tiles, not just re-emitting the pipeline.
      rebuildLayer();
      refreshInspector();
    });
  }

  document
    .getElementById("band-single")!
    .addEventListener("change", async (e) => {
      state.singleBand = parseInt(
        (e.target as HTMLSelectElement).value,
        10
      );
      await computePercentilesForBand(state.singleBand);
      rebuildLayer();
      refreshInspector();
    });

  document
    .getElementById("colormap-select")!
    .addEventListener("change", (e) => {
      state.colormap = (e.target as HTMLSelectElement).value;
      updateColormapPreview();
      updateControlVisibility();
      rerenderLayer();
    });

  document
    .getElementById("colormap-reversed")!
    .addEventListener("change", (e) => {
      state.colormapReversed = (e.target as HTMLInputElement).checked;
      updateColormapPreview();
      rerenderLayer();
    });

  // Each input updates only its own bound. Re-parsing both would replace
  // the untouched bound with its rounded display text.
  const bindBound = (id: string, key: "valueMin" | "valueMax") => {
    const input = document.getElementById(id) as HTMLInputElement;
    input.addEventListener("change", () => {
      // Number.isFinite, not `|| fallback`: a typed 0 is a legitimate bound.
      const v = parseFloat(input.value);
      if (!Number.isFinite(v)) return;
      state[key] = v;
      updateRangeLabel();
      rerenderLayer();
    });
  };
  bindBound("min-value", "valueMin");
  bindBound("max-value", "valueMax");

  document.getElementById("panel-toggle")!.addEventListener("click", () => {
    document.getElementById("panel")!.classList.toggle("collapsed");
  });

  populateColormapSelector();
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

function init(): void {
  const win = window as any;

  // The error overlay blocks the whole viewer; let the user dismiss it.
  document.getElementById("error-overlay")!.addEventListener("click", hideError);

  // Backstop for failures nothing else reports: without it an unawaited
  // rejection would leave the loading spinner up forever with no message.
  window.addEventListener("unhandledrejection", (e) => {
    if (isAbortError(e.reason)) return;
    console.error("[RasterEye] Unhandled rejection:", e.reason);
    showError(
      "Failed to load GeoTIFF: " + (e.reason?.message || String(e.reason)),
    );
  });
  const paramFile: string | undefined = win.__RASTEREYE_FILE_URL__;
  if (paramFile) {
    setFileUrl(paramFile);
    const name: string = win.__RASTEREYE_FILENAME__ || "GeoTIFF";
    const el = document.getElementById("filename");
    if (el) {
      el.textContent = name;
      el.title = name;
    }
  }

  const m = new maplibregl.Map({
    container: "map",
    style: BASEMAP_STYLES[state.basemap],
    center: [0, 0],
    zoom: 2,
    attributionControl: false,
  });
  setMap(m);
  initInspector(m);

  const ov = new MapLibreOverlay({
    interleaved: true,
    layers: [],
  });
  setOverlay(ov);

  m.addControl(ov);
  m.addControl(new maplibregl.NavigationControl(), "top-left");
  m.addControl(new maplibregl.AttributionControl({ compact: true }));

  setupControls();

  m.once("load", () => {
    const attrib = document.querySelector(".maplibregl-ctrl-attrib");
    if (attrib) attrib.classList.remove("maplibregl-compact-show");
  });

  // The raster needs the map's first style before deck.gl can draw into it,
  // and MapLibre never fires "load" if that style cannot be fetched (offline,
  // proxy, tile host down). Fall back to a blank local style so a local file
  // still opens without a basemap.
  let styleReady = false;
  m.on("error", (e: any) => {
    if (styleReady) return;
    styleReady = true;
    console.warn("[RasterEye] Basemap failed to load:", e?.error ?? e);
    showNotice("Basemap unavailable. Showing the raster without one.");
    m.setStyle(FALLBACK_STYLE);
  });
  m.once("styledata", () => { styleReady = true; });

  m.once("load", () => {
    if (fileUrl) {
      hideError();
      void loadFile(fileUrl);
    }
  });
}

document.addEventListener("DOMContentLoaded", init);
