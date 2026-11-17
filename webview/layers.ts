/// Layer routing. The active render path (tiled or strip) registers itself
/// once its file has loaded; until then control changes are ignored, so a
/// control touched during loading can never start a second, competing load.

export interface Renderer {
  /// Cheap re-render: keeps GPU textures, re-emits the render pipeline. Use
  /// for opacity / colormap / range changes.
  rerender(): void;
  /// Full rebuild: regenerates per-band GPU textures. Use when the band
  /// selection or render mode changes.
  rebuild(): void;
}

let renderer: Renderer | null = null;

export function setRenderer(r: Renderer | null): void {
  renderer = r;
}

export function rerenderLayer(): void {
  renderer?.rerender();
}

export function rebuildLayer(): void {
  renderer?.rebuild();
}
