/// Cell inspector: click a raster cell to see its values in a popup.
///
/// Both render paths resolve a click identically: WGS84 lng/lat -> file CRS
/// -> pixel row/col (inverse geotransform) -> raw DN for every band,
/// read from the full-resolution image. The reported cell is therefore the
/// file's true cell at the clicked location, independent of overview level
/// (tiled path) or display decimation (strip path).

import * as maplibregl from "maplibre-gl";
import { state, bandCount, bandNames, nodataValue, scalingActive } from "./state";
import { isNodata, dnToScaled, isAbortError, formatNum } from "./helpers";
import { tilePixels, bandView } from "./extract";

// ---------------------------------------------------------------------------
// Pure geometry helpers (unit-testable)
// ---------------------------------------------------------------------------

/// GDAL-order affine [a, b, c, d, e, f]: x = a*col + b*row + c, y = d*col + e*row + f.
export type Affine = [number, number, number, number, number, number];

export function invertAffine([a, b, c, d, e, f]: Affine): Affine {
  const det = a * e - b * d;
  if (det === 0) throw new Error("Degenerate geotransform");
  const ra = e / det, rb = -b / det, rd = -d / det, re = a / det;
  return [ra, rb, -c * ra - f * rb, rd, re, -c * rd - f * re];
}

export function applyAffine([a, b, c, d, e, f]: Affine, x: number, y: number): [number, number] {
  return [a * x + b * y + c, d * x + e * y + f];
}

// ---------------------------------------------------------------------------
// Source abstraction: one per render path
// ---------------------------------------------------------------------------

export interface InspectSource {
  width: number;
  height: number;
  crsLabel: string;
  /** WGS84 -> file CRS. May return non-finite values outside the CRS domain. */
  toNative(lng: number, lat: number): [number, number];
  /** File CRS -> fractional [row, col]. */
  pixelOf(x: number, y: number): [number, number];
  /** Raw DN of every band at a full-resolution cell. */
  readCell(row: number, col: number, signal: AbortSignal): Promise<number[]>;
}

export interface CellHit {
  row: number;
  col: number;
  x: number;
  y: number;
}

/// Resolve a click to a cell, or null when it falls outside the raster.
/// MapLibre's e.lngLat comes from map.unproject and is not wrapped when world
/// copies are rendered, so try the wrapped longitude and its +/-360 aliases
/// (also covers 0..360 longitude rasters in EPSG:4326).
export function locateCell(src: InspectSource, lng: number, lat: number): CellHit | null {
  const base = ((((lng + 180) % 360) + 360) % 360) - 180;
  for (const l of [base, base + 360, base - 360]) {
    const [x, y] = src.toNative(l, lat);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const [r, c] = src.pixelOf(x, y);
    const row = Math.floor(r), col = Math.floor(c);
    if (row >= 0 && col >= 0 && row < src.height && col < src.width) {
      return { row, col, x, y };
    }
  }
  return null;
}

/// Tiled path. `tiff` is the @developmentseed/geotiff GeoTIFF behind the
/// COGSource; `projectFrom4326` is the source's own WGS84 -> file CRS function
/// (cogSource.tilesetDescriptor.projectFrom4326), so the lookup uses the same
/// projection the layer renders with.
export function tiledSource(
  tiff: any,
  projectFrom4326: (lng: number, lat: number) => [number, number],
  pool: any,
): InspectSource {
  const tw: number = tiff.tileWidth;
  const th: number = tiff.tileHeight;
  // One decoded tile: repeat clicks in the same tile cost nothing.
  let cached: { key: string; array: any } | null = null;
  return {
    width: tiff.width,
    height: tiff.height,
    crsLabel: typeof tiff.crs === "number" ? `EPSG:${tiff.crs}` : "custom CRS",
    toNative: (lng, lat) => projectFrom4326(lng, lat),
    // identity rounding op -> fractional [row, col]; locateCell floors.
    pixelOf: (x, y) => tiff.index(x, y, (n: number) => n),
    async readCell(row, col, signal) {
      const tx = Math.floor(col / tw);
      const ty = Math.floor(row / th);
      const key = `${tx},${ty}`;
      if (cached?.key !== key) {
        // boundless:false clips edge tiles, so the row stride is the clipped
        // array width, not the nominal tile width.
        const tile = await tiff.fetchTile(tx, ty, { pool, boundless: false, signal });
        cached = { key, array: tile.array };
      }
      const arr = cached.array;
      const i = (row - ty * th) * arr.width + (col - tx * tw);
      const { px, spp } = tilePixels(arr);
      const out: number[] = [];
      for (let b = 0; b < spp; b++) {
        const v = bandView(px, spp, b);
        out.push(v.src[v.base + i * v.stride]);
      }
      return out;
    },
  };
}

/// Strip path. `tiff` is the same @developmentseed/geotiff header the tiled
/// path uses, so both resolve cells with the same geotransform. `bands` are
/// the arrays the strip layer draws; when they were decimated for display,
/// `image` must be the retained geotiff.js image so the true cell is read.
export function stripSource(opts: {
  tiff: any;
  projectFrom4326: (lng: number, lat: number) => [number, number];
  bands: ArrayLike<number>[];
  image: any | null;
}): InspectSource {
  const { tiff, bands, image } = opts;
  const width: number = tiff.width;
  return {
    width,
    height: tiff.height,
    crsLabel: typeof tiff.crs === "number" ? `EPSG:${tiff.crs}` : "custom CRS",
    toNative: opts.projectFrom4326,
    pixelOf: (x, y) => tiff.index(x, y, (n: number) => n),
    async readCell(row, col, signal) {
      if (!image) return bands.map((b) => b[row * width + col]);
      // Decodes only the strip(s) containing this row; the file bytes are
      // already in memory, so no I/O.
      const r = await image.readRasters({ window: [col, row, col + 1, row + 1], signal });
      return Array.from(r as ArrayLike<number>[], (a) => a[0]);
    },
  };
}

/// Float32 precision: 7 significant digits.
export const formatValue = (v: number): string => formatNum(v, 7);

// ---------------------------------------------------------------------------
// Popup controller
// ---------------------------------------------------------------------------

interface InspectResult extends CellHit {
  lng: number;
  lat: number;
  values: number[] | null;   // null while loading
  error?: string;
}

let source: InspectSource | null = null;
let popup: maplibregl.Popup | null = null;
let last: InspectResult | null = null;
let seq = 0;
let ctrl: AbortController | null = null;

export function setInspectSource(src: InspectSource | null): void {
  source = src;
  closeInspector();
}

export function closeInspector(): void {
  ctrl?.abort();
  ctrl = null;
  last = null;
  popup?.remove();
}

/// Re-render the open popup (e.g. after a band or mode change) without
/// re-reading: every band is already in `last.values`.
export function refreshInspector(): void {
  if (popup?.isOpen() && last) popup.setDOMContent(renderContent(last));
}

export function initInspector(map: maplibregl.Map): void {
  map.on("click", (e) => { void onMapClick(map, e); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeInspector();
  });
}

function ensurePopup(): maplibregl.Popup {
  if (!popup) {
    popup = new maplibregl.Popup({
      className: "re-inspect",
      closeButton: true,
      closeOnClick: false,   // we decide: on-raster click moves it, off-raster closes
      focusAfterOpen: false, // keep keyboard focus on the map
      maxWidth: "300px",
      offset: 8,
    });
    popup.on("close", () => {
      ctrl?.abort();
      last = null;
    });
  }
  return popup;
}

async function onMapClick(map: maplibregl.Map, e: maplibregl.MapMouseEvent): Promise<void> {
  if (!source) return;                        // metadata not loaded yet
  const hit = locateCell(source, e.lngLat.lng, e.lngLat.lat);
  if (!hit) { closeInspector(); return; }
  if (popup?.isOpen() && last && last.row === hit.row && last.col === hit.col) return;

  ctrl?.abort();
  const myCtrl = (ctrl = new AbortController());
  const mySeq = ++seq;
  const wrapped = e.lngLat.wrap();
  last = { ...hit, lng: wrapped.lng, lat: wrapped.lat, values: null };

  // Anchor at the click (unwrapped) so the popup sits on the clicked world copy.
  const p = ensurePopup().setLngLat(e.lngLat).setDOMContent(renderContent(last));
  if (!p.isOpen()) p.addTo(map);

  try {
    const values = await source.readCell(hit.row, hit.col, myCtrl.signal);
    if (mySeq !== seq) return;
    last = { ...last, values };
  } catch (err: any) {
    if (isAbortError(err, myCtrl.signal) || mySeq !== seq) return;
    // A sparse COG tile (TileByteCounts = 0) throws "Tile at (x, y) not found".
    last = { ...last, error: /not found/.test(String(err?.message)) ? "Empty tile (no data)" : String(err?.message ?? err) };
  }
  p.setDOMContent(renderContent(last));
}

/// Displayed band indices with their role label.
function displayedBands(): Map<number, string> {
  if (state.renderMode === "3band") {
    return new Map([[state.bandR, "R"], [state.bandG, "G"], [state.bandB, "B"]]);
  }
  return new Map([[state.singleBand, "●"]]);
}

/// DOM built with textContent only: band names come from file metadata.
function renderContent(r: InspectResult): HTMLElement {
  const root = el("div", "ri");
  root.append(
    el("div", "ri-head", `Row ${r.row}, Col ${r.col}`),
    el("div", "ri-sub", `${r.lat.toFixed(6)}, ${r.lng.toFixed(6)}`),
  );
  if (r.error) { root.append(el("div", "ri-msg", r.error)); return root; }
  if (!r.values) { root.append(el("div", "ri-msg", "Reading…")); return root; }

  const shown = displayedBands();
  const table = el("table");
  const head = el("tr");
  head.append(el("th", "", ""), el("th", "", "Band"), el("th", "num", scalingActive ? "DN" : "Value"));
  if (scalingActive) head.append(el("th", "num", "Scaled"));
  table.append(head);

  // Displayed bands first, then the rest in file order.
  const order = [...new Set([...shown.keys(), ...r.values.keys()])].filter((b) => b < r.values!.length);
  for (const b of order) {
    const dn = r.values[b];
    const nd = isNodata(dn, nodataValue);
    const tr = el("tr", shown.has(b) ? `active band-${(shown.get(b) ?? "").toLowerCase()}` : "");
    const name = bandNames[b] ? `${b + 1}: ${bandNames[b]}` : `Band ${b + 1}`;
    tr.append(el("td", "role", shown.get(b) ?? ""), el("td", "name", name), el("td", "num", formatValue(dn)));
    if (scalingActive) tr.append(el("td", "num", nd ? "nodata" : formatValue(dnToScaled(dn, b))));
    else if (nd) tr.lastElementChild!.textContent += " (nodata)";
    if (nd) tr.classList.add("nodata");
    table.append(tr);
  }
  const scroll = el("div", bandCount > 12 ? "ri-scroll" : "");
  scroll.append(table);
  root.append(scroll);
  return root;
}

function el(tag: string, cls = "", text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
