/// Shared utility functions.

import { nodataValue, scalingActive, bandScales, bandOffsets } from "./state";

export function isNodata(v: number, nodata: number | null): boolean {
  return v === nodata || Number.isNaN(v);
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
