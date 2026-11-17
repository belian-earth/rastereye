/// Tiled GeoTIFF rendering via COGLayer.
///
/// Both single-band and 3-band composite use a GPU pipeline: r32float band
/// textures with GDAL scale/offset baked in on CPU during extraction, then
/// nodata-filter / rescale / (colormap or composite) on the GPU. Colormap,
/// range, and opacity changes don't trigger any CPU work on cached tiles.

import { COGLayer, COGSource } from "@developmentseed/deck.gl-geotiff";
import type { GeographicBounds } from "@developmentseed/deck.gl-raster";
import { DecoderPool } from "@developmentseed/geotiff";
import { state, overlay } from "./state";
import { showError, isAbortError } from "./helpers";
import {
  buildBandTexture, buildRgbaBandsTexture,
  buildSinglebandPipeline, build3bandPipeline,
  getColormapTexture,
} from "./gpu-pipeline";
import { tilePixels } from "./extract";
import { setInspectSource, tiledSource } from "./inspect";
import { setRenderer } from "./layers";
import { resolveEpsg } from "./epsg";
import { setSampleProvider, PixelSample } from "./percentiles";

/// Shared decoder pool with no workers: tiles decode on the main thread.
/// Passing a pool explicitly is required even so, because the library's
/// default pool starts workers from a script URL that does not exist in this
/// bundle.
let decoderPool: any = null;
export function getDecoderPool(): any {
  if (!decoderPool) decoderPool = new DecoderPool({ size: 0 });
  return decoderPool;
}

/// The opened COG. COGSource.open resolves the CRS and builds the tile grid
/// once; every COGLayer generation draws this same instance, so a rebuild
/// never re-opens the file.
let cogSource: COGSource | null = null;

/// GPU textures of one layer generation. deck.gl calls onTileUnload on cache
/// eviction but not on layer teardown, so without explicit tracking a rebuild
/// strands every cached tile's texture until GC.
interface Generation {
  textures: Set<any>;
  /// Set once the generation has been replaced: tiles that finish decoding
  /// afterwards must free their texture instead of registering it.
  retired: boolean;
}
let generation: Generation = { textures: new Set(), retired: false };
let layerVersion = 0;
let currentLayerId = "cog-layer-0";
let tileErrorShown = false;
let colormapTexture: any = null;

function destroyTexture(texture: any): void {
  try {
    texture?.destroy?.();
  } catch { /* already destroyed */ }
}

/// Retire a generation and destroy its textures once the old layer has been
/// finalized (setProps swaps layers asynchronously; a short delay keeps us
/// from deleting textures a final frame still references).
function retire(gen: Generation): void {
  gen.retired = true;
  setTimeout(() => {
    gen.textures.forEach(destroyTexture);
    gen.textures.clear();
  }, 500);
}

/// Entry point for the tiled path. Returns the raster's geographic bounds.
export async function loadTiled(tiff: any): Promise<GeographicBounds> {
  cogSource = await COGSource.open(tiff, { epsgResolver: resolveEpsg });
  const project = cogSource.tilesetDescriptor.projectFrom4326;
  setInspectSource(tiledSource(
    tiff,
    (lng, lat) => project(lng, lat) as [number, number],
    getDecoderPool(),
  ));
  setSampleProvider(() => sampleTiles(tiff));
  setRenderer({ rerender: rerenderTiledLayer, rebuild: rebuildLayer });
  return cogSource.geographicBounds;
}

/// Pixels for the automatic stretch. With overviews, the coarsest level's
/// first tile spans most or all of the image. Without them, the full-
/// resolution top-left tile alone is often unrepresentative or all nodata,
/// so sample the centre and the four quarter points instead.
async function sampleTiles(tiff: any): Promise<PixelSample[]> {
  const overviews = tiff.overviews ?? [];
  const source = overviews.length > 0 ? overviews[overviews.length - 1] : tiff;
  const nx = Math.max(1, Math.ceil(source.width / source.tileWidth));
  const ny = Math.max(1, Math.ceil(source.height / source.tileHeight));
  const at = (fx: number, fy: number): [number, number] =>
    [Math.min(nx - 1, Math.floor(nx * fx)), Math.min(ny - 1, Math.floor(ny * fy))];
  const wanted = overviews.length > 0
    ? [at(0, 0), at(0.5, 0.5)]
    : [at(0.5, 0.5), at(0.25, 0.25), at(0.75, 0.25), at(0.25, 0.75), at(0.75, 0.75)];
  const unique = [...new Map(wanted.map((t) => [t.join(","), t])).values()];

  // boundless: false, because GDAL pads edge tiles with zeros (not nodata),
  // which would otherwise skew the stretch. Sparse tiles reject; skip them.
  const results = await Promise.allSettled(unique.map(([x, y]) =>
    source.fetchTile(x, y, { pool: getDecoderPool(), boundless: false })));
  const samples: PixelSample[] = [];
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    const arr = r.value.array;
    const { px, spp } = tilePixels(arr);
    samples.push({ px, spp, pixelCount: arr.width * arr.height, mask: arr.mask });
  }
  if (samples.length === 0) throw new Error("No readable tiles to sample");
  return samples;
}

// ---------------------------------------------------------------------------
// Layer management
// ---------------------------------------------------------------------------

function makeCOGLayerProps(layerId: string): any {
  const gen = generation;
  return {
    id: layerId,
    source: cogSource,
    opacity: state.opacity,
    pool: getDecoderPool(),
    onError: (err: any) => {
      console.error("[RasterEye] COGLayer error:", err);
      showError("Failed to render GeoTIFF: " + (err?.message || err));
    },
    onTileUnload: (tile: any) => {
      const texture = tile?.content?.texture;
      if (texture) {
        gen.textures.delete(texture);
        destroyTexture(texture);
      }
    },

    getTileData: async (image: any, options: any) => {
      if (!colormapTexture) {
        colormapTexture = await getColormapTexture(options.device);
      }

      try {
        // boundless: false clips edge tiles to the actual image bounds.
        // Without this, the last column/row of tiles is padded by GDAL to the
        // full nominal tile size, and that padding (often 0, not the declared
        // nodata) renders as a ghost region south/east of the raster.
        const tile = await image.fetchTile(options.x, options.y, {
          boundless: false,
          signal: options.signal,
        });
        const w = tile.array.width;
        const h = tile.array.height;
        // Tiles arrive pixel-interleaved or band-separate depending on the
        // file's PlanarConfiguration; tilePixels normalizes both layouts.
        const { px, spp } = tilePixels(tile.array);
        const mask = tile.array.mask;
        const is3band = state.renderMode === "3band";

        const texture = is3band
          ? buildRgbaBandsTexture(
              options.device, px, w, h, spp,
              state.bandR, state.bandG, state.bandB, mask,
            )
          : buildBandTexture(options.device, px, w, h, spp, state.singleBand, mask);

        // A tile superseded while it decoded (pan, zoom, or a rebuild) must
        // not hand its texture to a layer that will never unload it.
        if (gen.retired || options.signal?.aborted) {
          destroyTexture(texture);
          throw new DOMException("Tile superseded", "AbortError");
        }
        gen.textures.add(texture);
        return is3band
          ? { width: w, height: h, byteLength: w * h * 16, texture, mode: "3band" }
          : { width: w, height: h, byteLength: w * h * 4, texture };
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
      if (!td.texture) return null;
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

/// Discard the tile cache and re-fetch (band selection or render mode).
export function rebuildLayer(): void {
  if (!cogSource) return;
  layerVersion++;
  currentLayerId = `cog-layer-${layerVersion}`;
  retire(generation);
  generation = { textures: new Set(), retired: false };
  tileErrorShown = false;
  overlay.setProps({
    layers: [new COGLayer(makeCOGLayerProps(currentLayerId))],
  });
}

/// Keep the tile cache and replay renderTile via updateTriggers.
export function rerenderTiledLayer(): void {
  if (!cogSource) return;
  overlay.setProps({
    layers: [new COGLayer(makeCOGLayerProps(currentLayerId))],
  });
}
