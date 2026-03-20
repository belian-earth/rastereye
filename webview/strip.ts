/// Strip-layout GeoTIFF fallback — uses geotiff.js readRasters + BitmapLayer.

import { fromUrl as geotiffFromUrl } from "geotiff";
import proj4 from "proj4";
import { BitmapLayer } from "@deck.gl/layers";
import {
  state, overlay, fileUrl, bandCount, nodataValue, scalingActive,
  bandScales, bandOffsets, map,
  setBandCount, setNodataValue, setBandNames,
} from "./state";
import { renderBandsToRGBA } from "./render";
import { isNodata, dnToScaled, showLoading, showError } from "./helpers";
import { setRange } from "./range";
import { populateBandSelectors, updateControlVisibility } from "./ui";

// Exported for percentiles module to check which path we're on
export let stripBands: ArrayLike<number>[] = [];
let stripWidth = 0;
let stripHeight = 0;
let stripBbox: [number, number, number, number] = [0, 0, 0, 0];

// ---------------------------------------------------------------------------
// Projection helpers
// ---------------------------------------------------------------------------

async function ensureProjection(epsgCode: number): Promise<void> {
  if (epsgCode === 4326 || epsgCode === 3857) return;
  const key = `EPSG:${epsgCode}`;
  if (proj4.defs(key)) return;
  try {
    // Fetch OGC WKT — includes Helmert datum shift params directly,
    // avoiding grid files that browsers can't load.
    const resp = await fetch(`https://epsg.io/${epsgCode}.wkt`);
    if (resp.ok) {
      proj4.defs(key, await resp.text());
      return;
    }
  } catch { /* ignore */ }
  try {
    const resp = await fetch(`https://epsg.io/${epsgCode}.proj4`);
    if (resp.ok) proj4.defs(key, await resp.text());
  } catch { /* ignore */ }
}

function reprojectBBox(
  bbox: number[],
  epsgCode: number
): [number, number, number, number] {
  if (epsgCode === 4326) return bbox as [number, number, number, number];
  try {
    const ll = proj4(`EPSG:${epsgCode}`, "EPSG:4326", [bbox[0], bbox[1]]);
    const ur = proj4(`EPSG:${epsgCode}`, "EPSG:4326", [bbox[2], bbox[3]]);
    if (isFinite(ll[0]) && isFinite(ll[1]) && isFinite(ur[0]) && isFinite(ur[1])) {
      return [ll[0], ll[1], ur[0], ur[1]];
    }
    console.warn("[RasterEye] Reprojection produced NaN, using raw bbox");
    return bbox as [number, number, number, number];
  } catch {
    return bbox as [number, number, number, number];
  }
}

// ---------------------------------------------------------------------------
// File probing — detect tiled vs strip
// ---------------------------------------------------------------------------

export async function probeAndLoad(
  url: string,
  onTiled: () => void
): Promise<void> {
  try {
    const tiff = await geotiffFromUrl(url);
    const image = await tiff.getImage();

    if (image.isTiled) {
      onTiled();
    } else {
      await loadStripImage();
    }
  } catch (err: any) {
    console.error("[RasterEye] File probe failed:", err);
    showError("Failed to open GeoTIFF: " + (err?.message || err));
  }
}

// ---------------------------------------------------------------------------
// Strip image loading
// ---------------------------------------------------------------------------

async function loadStripImage(): Promise<void> {
  try {
    const tiff = await geotiffFromUrl(fileUrl);
    const image = await tiff.getImage();

    const w = image.getWidth();
    const h = image.getHeight();
    const spp = image.getSamplesPerPixel();

    const geoKeys = image.getGeoKeys() ?? {};
    const epsgCode =
      geoKeys.ProjectedCSTypeGeoKey || geoKeys.GeographicTypeGeoKey || 4326;
    await ensureProjection(epsgCode);

    const readW = Math.min(w, 4096);
    const readH = Math.min(h, 4096);
    const rasters = await image.readRasters({ width: readW, height: readH });

    const bands: ArrayLike<number>[] = [];
    for (let b = 0; b < spp; b++) {
      bands.push(rasters[b] as ArrayLike<number>);
    }

    setBandCount(spp);
    setNodataValue(image.getGDALNoData());

    // Band names from GDALMetadata XML
    try {
      const fileDir = image.fileDirectory as any;
      const gdalMd = fileDir?.GDAL_METADATA;
      if (gdalMd) {
        const doc = new DOMParser().parseFromString(gdalMd, "text/xml");
        const items = doc.querySelectorAll('Item[name="DESCRIPTION"]');
        if (items.length > 0) {
          const names = new Array(spp).fill("");
          items.forEach((item) => {
            const sample = item.getAttribute("sample");
            if (sample != null) {
              names[parseInt(sample, 10)] = item.textContent ?? "";
            }
          });
          setBandNames(names);
        }
      }
    } catch { /* ignore */ }

    stripBbox = reprojectBBox(image.getBoundingBox(), epsgCode);
    stripBands = bands;
    stripWidth = readW;
    stripHeight = readH;

    // Compute percentiles from first band
    const bi = Math.min(state.singleBand, spp - 1);
    const nodata = nodataValue;
    const values: number[] = [];
    const band = bands[bi];
    for (let i = 0; i < band.length; i++) {
      const v = band[i];
      if (isNodata(v, nodata)) continue;
      values.push(scalingActive ? dnToScaled(v, bi) : v);
    }
    if (values.length >= 10) {
      values.sort((a, b) => a - b);
      setRange(
        values[Math.floor(values.length * 0.02)],
        values[Math.floor(values.length * 0.98)]
      );
    }

    state.renderMode = "singleband";
    (document.getElementById("mode-select") as HTMLSelectElement).value =
      "singleband";
    populateBandSelectors(spp);
    updateControlVisibility();
    showLoading(false);

    const [west, south, east, north] = stripBbox;
    map.fitBounds(
      [[west, south], [east, north]],
      { padding: 50, maxZoom: 18 }
    );

    renderStripImage();
  } catch (err: any) {
    console.error("[RasterEye] Strip reading failed:", err);
    showError("Failed to read GeoTIFF: " + (err?.message || err));
  }
}

// ---------------------------------------------------------------------------
// Strip rendering
// ---------------------------------------------------------------------------

export function renderStripImage(): void {
  if (stripBands.length === 0) return;

  const rgba = renderBandsToRGBA(stripBands, stripWidth, stripHeight);

  const canvas = document.createElement("canvas");
  canvas.width = stripWidth;
  canvas.height = stripHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(new ImageData(rgba, stripWidth, stripHeight), 0, 0);

  const [west, south, east, north] = stripBbox;
  overlay.setProps({
    layers: [
      new BitmapLayer({
        id: "strip-raster",
        image: canvas,
        bounds: [west, south, east, north],
        opacity: state.opacity,
      }),
    ],
  });
}
