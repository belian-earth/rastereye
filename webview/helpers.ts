/// Shared utility functions.

import { nodataValue, scalingActive, bandScales, bandOffsets } from "./state";

export function isNodata(v: number, nodata: number | null): boolean {
  return v === nodata || Number.isNaN(v);
}

/// True if err represents an aborted request. Aborts are routine during
/// pan/zoom (deck.gl cancels superseded tiles), but chunkd's SourceHttp
/// wraps them in a generic SourceError ("Failed to fetch: <url>", code 500)
/// with the AbortError only in `cause` — so trust the request's own signal
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

export function formatNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(4);
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
