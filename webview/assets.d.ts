// Ambient declarations for esbuild-loaded assets.
declare module "*.png" {
  const data: Uint8Array;
  export default data;
}
declare module "*.css";

/// MapLibre's worker bundle as source text (esbuild plugin in esbuild.mjs).
declare module "maplibre-worker-source" {
  const source: string;
  export default source;
}
declare module "*.wasm" {
  const data: Uint8Array;
  export default data;
}
declare module "proj4-list" {
  const list: Record<string, [string, string]>;
  export default list;
}
