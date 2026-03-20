/// Layer routing — delegates to tiled or strip renderer based on active path.

import { fileUrl, geotiffObj } from "./state";
import { rerenderTiledLayer } from "./tiled";
import { stripBands, renderStripImage } from "./strip";

export function rerenderLayer(): void {
  if (!fileUrl && !geotiffObj) return;
  if (stripBands.length > 0) {
    renderStripImage();
  } else {
    rerenderTiledLayer();
  }
}
