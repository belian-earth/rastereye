/// Value range management.

import { state, scalingActive } from "./state";
import { formatNum } from "./helpers";

export function setRange(min: number, max: number): void {
  state.valueMin = min;
  state.valueMax = max;
  const minEl = document.getElementById("min-value") as HTMLInputElement;
  const maxEl = document.getElementById("max-value") as HTMLInputElement;
  minEl.value = formatNum(min);
  maxEl.value = formatNum(max);
  const step = Math.abs(max - min) / 20 || 0.01;
  const stepStr = step < 1 ? step.toPrecision(2) : String(Math.round(step));
  minEl.step = stepStr;
  maxEl.step = stepStr;
  const label = scalingActive ? "Scaled range" : "Display range";
  document.getElementById("data-range-info")!.textContent =
    `${label}: ${formatNum(min)} \u2192 ${formatNum(max)}`;
}
