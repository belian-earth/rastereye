/// Tiled GeoTIFF rendering via COGLayer.

import { COGLayer } from "@developmentseed/deck.gl-geotiff";
import { DecoderPool } from "@developmentseed/geotiff";
import { CreateTexture } from "@developmentseed/deck.gl-raster/gpu-modules";
import {
  state, overlay, fileUrl, geotiffObj, bandCount, nodataValue,
  bandScales, bandOffsets, scalingActive, gpuDevice,
  setGeotiffObj, setBandCount, setNodataValue, setBandScales,
  setBandOffsets, setBandNames, setScalingActive, setGpuDevice,
  map,
} from "./state";
import { renderInterleavedToRGBA } from "./render";
import { showLoading } from "./helpers";
import { setRange } from "./range";
import { dnToScaled } from "./helpers";
import { computePercentilesForBand } from "./percentiles";
import { populateBandSelectors, updateControlVisibility } from "./ui";
import { updateDefaultRange } from "./tiled-range";

export const mainThreadPool = new DecoderPool({ size: 0 });

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

// ---------------------------------------------------------------------------
// Texture building (CPU normalize → GPU texture)
// ---------------------------------------------------------------------------

function buildTexture(
  device: any,
  data: any,
  w: number,
  h: number,
  spp: number
): any {
  const out = renderInterleavedToRGBA(data, w, h, spp);
  return device.createTexture({
    data: out,
    width: w,
    height: h,
    format: "rgba8unorm",
  });
}

// ---------------------------------------------------------------------------
// Layer management
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

    getTileData: async (image: any, options: any) => {
      const device = options.device;
      if (!gpuDevice) setGpuDevice(device);

      try {
        const tile = await image.fetchTile(options.x, options.y, {
          signal: options.signal,
        });
        const data = tile.array.data;
        const w = tile.array.width;
        const h = tile.array.height;
        const spp = Math.max(1, Math.round(data.length / (w * h)));

        return {
          width: w,
          height: h,
          data,
          spp,
          texture: buildTexture(device, data, w, h, spp),
        };
      } catch (err: any) {
        console.error("[RasterEye] fetchTile FAILED:", err);
        throw err;
      }
    },

    renderTile: (td: any) => {
      if (!td.data || !gpuDevice) return new ImageData(1, 1);
      const texture = buildTexture(gpuDevice, td.data, td.width, td.height, td.spp);
      return [
        { module: CreateTexture, props: { textureName: texture } },
      ];
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
