/// Tiled GeoTIFF rendering via COGLayer.
///
/// Both single-band and 3-band composite use a GPU pipeline: r32float band
/// textures with GDAL scale/offset baked in on CPU during extraction, then
/// nodata-filter / rescale / (colormap or composite) on the GPU. Colormap,
/// range, and opacity changes don't trigger any CPU work on cached tiles.

import { COGLayer } from "@developmentseed/deck.gl-geotiff";
import { DecoderPool } from "@developmentseed/geotiff";
import {
  state, overlay, fileUrl, geotiffObj, bandCount, nodataValue,
  bandScales, bandOffsets, scalingActive, gpuDevice,
  setGeotiffObj, setBandCount, setNodataValue, setBandScales,
  setBandOffsets, setBandNames, setScalingActive, setGpuDevice,
  map,
} from "./state";
import { showLoading } from "./helpers";
import {
  buildBandTexture, buildRgbaBandsTexture,
  buildSinglebandPipeline, build3bandPipeline,
  getColormapTexture,
} from "./gpu-pipeline";
import { populateBandSelectors, updateControlVisibility } from "./ui";
import { updateDefaultRange } from "./tiled-range";

/// Shared main-thread decoder pool. Tile decompression runs synchronously on
/// the main thread (worker-backed pools were tried but the perceived UI
/// latency was worse — see Apr 2026 discussion).
let decoderPool: any = null;
export function getDecoderPool(): any {
  if (!decoderPool) decoderPool = new DecoderPool({ size: 0 });
  return decoderPool;
}

// Layer versioning for cache management
let layerVersion = 0;
let currentLayerId = "cog-layer-0";

// ---------------------------------------------------------------------------
// Metadata handler (called by COGLayer's onGeoTIFFLoad)
// ---------------------------------------------------------------------------

export function handleGeoTIFFLoad(tiff: any, opts: any): void {
  if (geotiffObj) return;
  setGeotiffObj(tiff);

  setBandCount(tiff.count ?? 1);
  setNodataValue(tiff.nodata ?? null);

  try {
    setBandScales(tiff.scales ?? []);
    setBandOffsets(tiff.offsets ?? []);
  } catch {
    setBandScales([]);
    setBandOffsets([]);
  }
  setScalingActive(
    bandScales.length > 0 &&
    (bandScales.some((s: number) => s !== 1) ||
      bandOffsets.some((o: number) => o !== 0))
  );

  // Extract band descriptions from GDALMetadata XML
  let names: string[] = [];
  try {
    const rawXml: string | null = tiff.cachedTags?.gdalMetadata ?? null;
    if (rawXml) {
      const doc = new DOMParser().parseFromString(rawXml, "text/xml");
      const items = doc.querySelectorAll('Item[name="DESCRIPTION"]');
      if (items.length > 0) {
        names = new Array(bandCount).fill("");
        items.forEach((item) => {
          const sample = item.getAttribute("sample");
          if (sample != null) {
            names[parseInt(sample, 10)] = item.textContent ?? "";
          }
        });
      }
    }
  } catch { /* ignore */ }
  setBandNames(names);

  console.log("[RasterEye] onGeoTIFFLoad:", {
    bands: bandCount,
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
        [[west, south], [east, north]],
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

// Cached colormap sprite texture, populated lazily on first GPU tile render.
let colormapTexture: any = null;

// ---------------------------------------------------------------------------
// Layer management
// ---------------------------------------------------------------------------

function makeCOGLayerProps(layerId: string): any {
  return {
    id: layerId,
    geotiff: geotiffObj || fileUrl,
    opacity: state.opacity,
    pool: getDecoderPool(),
    onGeoTIFFLoad: handleGeoTIFFLoad,
    onError: (err: any) => {
      console.error("[RasterEye] COGLayer error:", err);
    },

    getTileData: async (image: any, options: any) => {
      if (!gpuDevice) setGpuDevice(options.device);
      if (!colormapTexture) {
        colormapTexture = await getColormapTexture(options.device);
      }

      try {
        const tile = await image.fetchTile(options.x, options.y, {
          signal: options.signal,
        });
        const data = tile.array.data;
        const w = tile.array.width;
        const h = tile.array.height;
        const spp = Math.max(1, Math.round(data.length / (w * h)));

        if (state.renderMode === "singleband") {
          const texture = buildBandTexture(
            options.device, data, w, h, spp, state.singleBand,
          );
          return { width: w, height: h, byteLength: w * h * 4, texture };
        }

        // 3-band composite: upload R/G/B + alpha as a single rgba32float
        // texture. One sampler, one upload — same shape as single-band.
        const texture = buildRgbaBandsTexture(
          options.device, data, w, h, spp,
          state.bandR, state.bandG, state.bandB,
        );
        return { width: w, height: h, byteLength: w * h * 16, texture, mode: "3band" };
      } catch (err: any) {
        console.error("[RasterEye] fetchTile FAILED:", err);
        throw err;
      }
    },

    renderTile: (td: any) => {
      if (!gpuDevice || !td.texture) return null;
      if (td.mode === "3band") {
        return { renderPipeline: build3bandPipeline(td.texture) };
      }
      if (colormapTexture) {
        return {
          renderPipeline: buildSinglebandPipeline(td.texture, colormapTexture),
        };
      }
      return null;
    },

    updateTriggers: {
      renderTile: [
        state.renderMode,
        state.colormap,
        state.colormapReversed,
        state.valueMin,
        state.valueMax,
      ],
    },
  };
}

export function rebuildLayer(): void {
  if (!fileUrl && !geotiffObj) return;
  layerVersion++;
  currentLayerId = `cog-layer-${layerVersion}`;
  overlay.setProps({
    layers: [new COGLayer(makeCOGLayerProps(currentLayerId))],
  });
}

export function rerenderTiledLayer(): void {
  if (!fileUrl && !geotiffObj) return;
  overlay.setProps({
    layers: [new COGLayer(makeCOGLayerProps(currentLayerId))],
  });
}
