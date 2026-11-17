/// File loading: open the header once, then hand off to the tiled or strip
/// path. Metadata and the post-load UI setup are shared by both.

import { GeoTIFF } from "@developmentseed/geotiff";
import { DEFAULT_RANGE_READER } from "@developmentseed/deck.gl-raster";
import type { GeographicBounds } from "@developmentseed/deck.gl-raster";
import { DEFAULT_CONCURRENCY_LIMITER } from "@developmentseed/deck.gl-geotiff";
import { state, map, bandCount } from "./state";
import { showError, showLoading } from "./helpers";
import { applyMetadata, fallbackRange, hasNoGeoreference, isLerc, paletteOf } from "./metadata";
import { ensureLercLoaded } from "./lerc";
import { setPalette } from "./gpu-pipeline";
import { setRange } from "./range";
import { computePercentilesForBand } from "./percentiles";
import { populateBandSelectors, updateControlVisibility, enablePaletteColormap } from "./ui";
import { rebuildLayer, rerenderLayer } from "./layers";
import { loadTiled } from "./tiled";
import { loadStrip } from "./strip";

export async function loadFile(url: string): Promise<void> {
  try {
    // The shared reader and limiter are the ones COGLayer uses, so header
    // and tile reads are batched and cached together.
    const tiff = await GeoTIFF.fromUrl(url, {
      reader: DEFAULT_RANGE_READER,
      concurrencyLimiter: DEFAULT_CONCURRENCY_LIMITER,
    });

    // VS Code activates this editor on the filename alone, so any *.tif
    // lands here. Fail with a clear message instead of an opaque CRS error.
    if (hasNoGeoreference(tiff)) {
      showError(
        "This TIFF has no geographic metadata. RasterEye is for georeferenced rasters. Open it with the default image viewer instead.",
      );
      return;
    }
    if (isLerc(tiff)) await ensureLercLoaded();

    applyMetadata(tiff);
    const palette = paletteOf(tiff);
    setPalette(palette);
    if (palette) enablePaletteColormap();
    const bounds = tiff.isTiled ? await loadTiled(tiff) : await loadStrip(tiff);
    finishLoad(tiff, bounds);
  } catch (err: any) {
    console.error("[RasterEye] Failed to open GeoTIFF:", err);
    showError("Failed to open GeoTIFF: " + (err?.message || err));
  }
}

function finishLoad(tiff: any, bounds: GeographicBounds): void {
  try {
    const { west, south, east, north } = bounds;
    map.fitBounds([[west, south], [east, north]], { padding: 50, maxZoom: 18 });
  } catch (err) {
    console.warn("[RasterEye] Failed to fit bounds:", err);
  }

  state.renderMode = "singleband";
  (document.getElementById("mode-select") as HTMLSelectElement).value = "singleband";
  populateBandSelectors(bandCount);
  updateControlVisibility();

  // Draw immediately with a type-based stretch, then re-emit the pipeline
  // once the real 2-98% range has been sampled.
  setRange(...fallbackRange(tiff));
  showLoading(false);
  rebuildLayer();
  computePercentilesForBand(state.singleBand).then(() => rerenderLayer());
}
