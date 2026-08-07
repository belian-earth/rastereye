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
import { showLoading, showError, isAbortError } from "./helpers";
import {
  buildBandTexture, buildRgbaBandsTexture,
  buildSinglebandPipeline, build3bandPipeline,
  getColormapTexture,
} from "./gpu-pipeline";
import { populateBandSelectors, updateControlVisibility } from "./ui";
import { updateDefaultRange } from "./tiled-range";
import { tilePixels } from "./extract";

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

// GPU textures created for the current layer generation. deck.gl's tileset
// calls onTileUnload on cache eviction but not on layer teardown, so without
// explicit tracking a rebuild strands every cached tile's texture until GC.
let liveTextures = new Set<any>();
let tileErrorShown = false;

function destroyTexture(texture: any): void {
  try {
    texture?.destroy?.();
  } catch { /* already destroyed */ }
}

/// Destroy all textures of the outgoing generation once the old layer has
/// been finalized (setProps swaps layers asynchronously; a short delay keeps
/// us from deleting textures a final frame still references).
function sweepTextures(textures: Set<any>): void {
  setTimeout(() => textures.forEach(destroyTexture), 500);
}

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

  // Percentiles resolve async; tiles rendered before then use the type-based
  // fallback stretch. Re-emit the render pipeline once the real 2-98% range
  // lands so early tiles don't keep a different stretch than later ones.
  updateDefaultRange(tiff).then(() => rerenderTiledLayer());

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
      showError("Failed to render GeoTIFF: " + (err?.message || err));
    },
    onTileUnload: (tile: any) => {
      const texture = tile?.content?.texture;
      if (texture) {
        liveTextures.delete(texture);
        destroyTexture(texture);
      }
    },

    getTileData: async (image: any, options: any) => {
      if (!gpuDevice) setGpuDevice(options.device);
      if (!colormapTexture) {
        colormapTexture = await getColormapTexture(options.device);
      }

      try {
        // boundless: false clips edge tiles to the actual image bounds.
        // Without this, the last column/row of tiles is padded by GDAL to the
        // full 512×512 nominal tile size, and that padding (often 0, not the
        // declared NaN nodata) renders as a ghost region south/east of the
        // raster. Matches the upstream deck.gl-geotiff default pipeline.
        const tile = await image.fetchTile(options.x, options.y, {
          boundless: false,
          signal: options.signal,
        });
        const w = tile.array.width;
        const h = tile.array.height;
        // Tiles arrive pixel-interleaved or band-separate depending on the
        // file's PlanarConfiguration; tilePixels normalizes both layouts.
        const { px, spp } = tilePixels(tile.array);

        if (state.renderMode === "singleband") {
          const texture = buildBandTexture(
            options.device, px, w, h, spp, state.singleBand,
          );
          liveTextures.add(texture);
          return { width: w, height: h, byteLength: w * h * 4, texture };
        }

        // 3-band composite: upload R/G/B + alpha as a single rgba32float
        // texture. One sampler, one upload — same shape as single-band.
        const texture = buildRgbaBandsTexture(
          options.device, px, w, h, spp,
          state.bandR, state.bandG, state.bandB,
        );
        liveTextures.add(texture);
        return { width: w, height: h, byteLength: w * h * 16, texture, mode: "3band" };
      } catch (err: any) {
        if (isAbortError(err, options.signal)) {
          throw err;
        }
        console.error("[RasterEye] fetchTile FAILED:", err);
        // Real decode failures get surfaced once instead of leaving a
        // silently blank map.
        if (!tileErrorShown) {
          tileErrorShown = true;
          showError("Failed to load raster tiles: " + (err?.message || err));
        }
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
  sweepTextures(liveTextures);
  liveTextures = new Set();
  tileErrorShown = false;
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
