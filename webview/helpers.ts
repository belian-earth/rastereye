/// Shared utility functions.

import { bandScales, bandOffsets } from "./state";

/// True for NaN and for the file's nodata value. The nodata tag is parsed as
/// a double, but Float32 samples hold its nearest float32, so a value such as
/// -9999.99 or 1e20 never equals the tag exactly. Compare against both forms,
/// as GDAL does by casting nodata to the band type.
export function isNodata(v: number, nodata: number | null): boolean {
  if (v !== v) return true;
  if (nodata === null) return false;
  return v === nodata || v === Math.fround(nodata);
}

/// True if err represents an aborted request. Aborts are routine during
/// pan/zoom (deck.gl cancels superseded tiles), and libraries may wrap them
/// with the AbortError only in `cause`, so trust the request's own signal
/// first, then walk the cause chain.
export function isAbortError(err: any, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  for (let e = err, depth = 0; e && depth < 8; e = e.cause, depth++) {
    if (e.name === "AbortError") return true;
  }
  return false;
}

export function dnToScaled(dn: number, bandIdx: number): number {
  return dn * (bandScales[bandIdx] ?? 1) + (bandOffsets[bandIdx] ?? 0);
}

/// Up to `digits` significant digits, exponent form for extremes.
export function formatNum(v: number, digits = 6): string {
  if (Number.isNaN(v)) return "NaN";
  if (!Number.isFinite(v)) return v > 0 ? "+Inf" : "-Inf";
  if (Number.isInteger(v)) return String(v);
  const a = Math.abs(v);
  if (a < 1e-4 || a >= 1e7) return v.toExponential(Math.min(4, digits - 1));
  return String(Number(v.toPrecision(digits)));
}

export function showLoading(show: boolean): void {
  document
    .getElementById("loading-overlay")!
    .classList.toggle("hidden", !show);
}

export function showError(msg: string): void {
  document.getElementById("error-box")!.textContent = msg;
  document.getElementById("error-overlay")!.classList.remove("hidden");
  showLoading(false);
}

export function hideError(): void {
  document.getElementById("error-overlay")!.classList.add("hidden");
}

/// Non-blocking message at the bottom of the map (e.g. basemap unavailable).
export function showNotice(msg: string): void {
  const el = document.getElementById("notice");
  if (!el) return;
  el.textContent = msg;
  el.classList.remove("hidden");
}
