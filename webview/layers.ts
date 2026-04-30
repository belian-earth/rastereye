/// Layer routing — delegates to tiled or strip renderer based on active path.

import { fileUrl, geotiffObj } from "./state";
import { rerenderTiledLayer, rebuildLayer as rebuildTiledLayer } from "./tiled";
import { stripBands, renderStripImage } from "./strip";

/// Cheap re-render: keeps the tile cache, replays renderTile via deck.gl
/// updateTriggers. Use for opacity / colormap / range changes.
export function rerenderLayer(): void {
  if (!fileUrl && !geotiffObj) return;
  if (stripBands.length > 0) {
    renderStripImage();
  } else {
    rerenderTiledLayer();
  }
}

/// Full rebuild: discards the tile cache and re-fetches. Use when the
/// per-tile GPU texture must be regenerated (single-band index, render mode).
export function rebuildLayer(): void {
  if (!fileUrl && !geotiffObj) return;
  if (stripBands.length > 0) {
    renderStripImage();
  } else {
    rebuildTiledLayer();
  }
}
