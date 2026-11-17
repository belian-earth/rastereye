/// Strip-layout GeoTIFF path.
///
/// deck.gl-raster reads tiled files only (upstream issue 573), so the pixels
/// of a strip file are decoded in one piece with geotiff.js. Everything else
/// matches the tiled path: metadata comes from the same header, the image is
/// warped from its own CRS by deck.gl-raster, and colouring runs on the GPU.

import { fromArrayBuffer } from "geotiff";
import type { GeographicBounds } from "@developmentseed/deck.gl-raster";
import { parseWkt, projectionFunctions, geographicBounds } from "@developmentseed/proj";
import { resolveEpsg } from "./epsg";
import { state, overlay, fileUrl } from "./state";
import { setInspectSource, stripSource, applyAffine, invertAffine, Affine } from "./inspect";
import { setRenderer } from "./layers";
import { setSampleProvider } from "./percentiles";
import { StripLayer } from "./strip-layer";

/// Largest display texture edge. Bigger images are decimated for display;
/// the cell inspector still reads full-resolution values.
const MAX_DISPLAY_SIZE = 4096;
/// The whole file is buffered, then decoded at full resolution in memory.
const MAX_FILE_BYTES = 1_000_000_000;
const MAX_DECODED_BYTES = 2_000_000_000;

export class StripTooLargeError extends Error {}

function tooLarge(what: string, bytes: number): StripTooLargeError {
  return new StripTooLargeError(
    `This stripped GeoTIFF is too large to load in one piece (${what}: ` +
    `${(bytes / 1e9).toFixed(1)} GB). Convert it to a Cloud-Optimized GeoTIFF ` +
    `for tiled loading, e.g.: gdal_translate -of COG input.tif output.tif`,
  );
}

let stripBands: ArrayLike<number>[] = [];
let displayWidth = 0;
let displayHeight = 0;
let reprojectionFns: any = null;

/// Entry point for the strip path. `tiff` is the opened header
/// (@developmentseed/geotiff). Returns the raster's geographic bounds.
export async function loadStrip(tiff: any): Promise<GeographicBounds> {
  const w: number = tiff.width;
  const h: number = tiff.height;
  const spp: number = tiff.count ?? 1;

  // Guard on the decoded size as well as the file size: a well-compressed
  // file can expand to many times its size on disk.
  const bits: number = tiff.cachedPrimaryImageTags?.bitsPerSample?.[0] ?? 8;
  const decodedBytes = w * h * spp * Math.ceil(bits / 8);
  if (decodedBytes > MAX_DECODED_BYTES) throw tooLarge("decoded size", decodedBytes);

  const crs = tiff.crs;
  const projection = typeof crs === "number" ? await resolveEpsg(crs) : parseWkt(crs);
  const fns = projectionFunctions(projection);

  // Read the whole file in one request. Strip files hold one row per strip,
  // so range-based reading would issue thousands of small requests.
  const resp = await fetch(fileUrl);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
  const contentLength = Number(resp.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_FILE_BYTES) {
    throw tooLarge("file size", contentLength);
  }
  const image = await (await fromArrayBuffer(await resp.arrayBuffer())).getImage();

  displayWidth = Math.min(w, MAX_DISPLAY_SIZE);
  displayHeight = Math.min(h, MAX_DISPLAY_SIZE);
  const decimated = displayWidth < w || displayHeight < h;
  const rasters = await image.readRasters({ width: displayWidth, height: displayHeight });
  stripBands = Array.from({ length: spp }, (_, b) => rasters[b] as ArrayLike<number>);

  // Display pixel -> file CRS -> longitude/latitude. The affine maps full-
  // resolution pixels, so display pixels are scaled up first.
  const affine = tiff.transform as Affine;
  const inverse = invertAffine(affine);
  const sx = w / displayWidth;
  const sy = h / displayHeight;
  reprojectionFns = {
    forwardTransform: (x: number, y: number) => applyAffine(affine, x * sx, y * sy),
    inverseTransform: (x: number, y: number) => {
      const [col, row] = applyAffine(inverse, x, y);
      return [col / sx, row / sy];
    },
    forwardReproject: fns.projectTo4326,
    inverseReproject: fns.projectFrom4326,
  };

  setInspectSource(stripSource({
    tiff,
    projectFrom4326: (lng, lat) => fns.projectFrom4326(lng, lat) as [number, number],
    bands: stripBands,
    // Retain the decoder only when the display bands were decimated, so the
    // true cell can still be read.
    image: decimated ? image : null,
  }));
  setSampleProvider(async () => [{
    px: { bands: stripBands },
    spp,
    pixelCount: displayWidth * displayHeight,
  }]);
  setRenderer({ rerender: renderStrip, rebuild: renderStrip });

  const [minX, minY, maxX, maxY] = tiff.bbox;
  const [west, south, east, north] = geographicBounds(
    [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]],
    fns.projectTo4326,
  );
  return { west, south, east, north };
}

function renderStrip(): void {
  if (stripBands.length === 0) return;
  const textureKey = state.renderMode === "3band"
    ? `rgb-${state.bandR}-${state.bandG}-${state.bandB}`
    : `band-${state.singleBand}`;
  overlay.setProps({
    layers: [
      new StripLayer({
        id: "strip-raster",
        opacity: state.opacity,
        bands: stripBands,
        width: displayWidth,
        height: displayHeight,
        reprojectionFns,
        mode: state.renderMode,
        singleBand: state.singleBand,
        bandR: state.bandR,
        bandG: state.bandG,
        bandB: state.bandB,
        textureKey,
        pipelineKey: [
          state.colormap, state.colormapReversed, state.valueMin, state.valueMax,
        ].join("|"),
      }),
    ],
  });
}
