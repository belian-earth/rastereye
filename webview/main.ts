/// <reference lib="dom" />
/// Entry point — map init, control wiring, file loading dispatch.

import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapboxOverlay } from "@deck.gl/mapbox";
import {
  state, BASEMAP_STYLES, setMap, setOverlay, setFileUrl, map, fileUrl,
} from "./state";
import { hideError, showError, isAbortError } from "./helpers";
import { updateColormapPreview, updateControlVisibility, populateColormapSelector } from "./ui";
import { rerenderLayer, rebuildLayer } from "./layers";
import { probeAndLoad } from "./strip";
import { computePercentilesForBand } from "./percentiles";

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
    });

  document
    .getElementById("colormap-select")!
    .addEventListener("change", (e) => {
      state.colormap = (e.target as HTMLSelectElement).value;
      updateColormapPreview();
      rerenderLayer();
    });

  document
    .getElementById("colormap-reversed")!
    .addEventListener("change", (e) => {
      state.colormapReversed = (e.target as HTMLInputElement).checked;
      updateColormapPreview();
      rerenderLayer();
    });

  const minInput = document.getElementById("min-value") as HTMLInputElement;
  const maxInput = document.getElementById("max-value") as HTMLInputElement;
  const onRangeChange = () => {
    // Number.isFinite, not `|| fallback`: a typed 0 is a legitimate bound.
    const mn = parseFloat(minInput.value);
    const mx = parseFloat(maxInput.value);
    if (Number.isFinite(mn)) state.valueMin = mn;
    if (Number.isFinite(mx)) state.valueMax = mx;
    rerenderLayer();
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

  // The error overlay blocks the whole viewer; let the user dismiss it.
  document.getElementById("error-overlay")!.addEventListener("click", hideError);

  // Backstop for failures nothing else reports — e.g. COGLayer's internal
  // GeoTIFF parse runs as an unawaited promise, so a CRS lookup failure
  // would otherwise leave the loading spinner up forever with no message.
  window.addEventListener("unhandledrejection", (e) => {
    if (isAbortError(e.reason)) return;
    console.error("[RasterEye] Unhandled rejection:", e.reason);
    showError(
      "Failed to load GeoTIFF: " + (e.reason?.message || String(e.reason)),
    );
  });
  const params = new URLSearchParams(window.location.search);
  const paramFile = win.__RASTEREYE_FILE_URL__ || params.get("file");
  const paramName =
    win.__RASTEREYE_FILENAME__ ||
    params.get("name") ||
    paramFile?.split("/").pop() ||
    "GeoTIFF";

  if (paramFile) {
    setFileUrl(paramFile);
    const el = document.getElementById("filename");
    if (el) {
      el.textContent = paramName;
      el.title = paramName;
    }
    if (!win.__RASTEREYE_FILE_URL__) {
      document.title = `RasterEye - ${paramName}`;
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

  const ov = new MapboxOverlay({
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

  m.on("load", () => {
    if (fileUrl) {
      hideError();
      probeAndLoad(fileUrl, () => rebuildLayer());
    }
  });
}

document.addEventListener("DOMContentLoaded", init);
