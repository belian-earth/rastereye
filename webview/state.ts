/// Shared mutable state and types for the viewer.

export interface ViewerState {
  basemap: string;
  opacity: number;
  renderMode: "singleband" | "3band";
  bandR: number;
  bandG: number;
  bandB: number;
  singleBand: number;
  colormap: string;
  valueMin: number;
  valueMax: number;
}

export const state: ViewerState = {
  basemap: "light",
  opacity: 1.0,
  renderMode: "singleband",
  bandR: 0,
  bandG: 1,
  bandB: 2,
  singleBand: 0,
  colormap: "viridis",
  valueMin: 0,
  valueMax: 255,
};

// Mutable globals shared across modules
export let map: any;
export let overlay: any;
export let fileUrl = "";
export let geotiffObj: any = null;
export let bandCount = 0;
export let nodataValue: number | null = null;
export let bandScales: number[] = [];
export let bandOffsets: number[] = [];
export let bandNames: string[] = [];
export let scalingActive = false;
export let gpuDevice: any = null;

// Setters for globals (modules can't reassign imported bindings)
export function setMap(m: any) { map = m; }
export function setOverlay(o: any) { overlay = o; }
export function setFileUrl(u: string) { fileUrl = u; }
export function setGeotiffObj(g: any) { geotiffObj = g; }
export function setBandCount(n: number) { bandCount = n; }
export function setNodataValue(v: number | null) { nodataValue = v; }
export function setBandScales(s: number[]) { bandScales = s; }
export function setBandOffsets(o: number[]) { bandOffsets = o; }
export function setBandNames(n: string[]) { bandNames = n; }
export function setScalingActive(v: boolean) { scalingActive = v; }
export function setGpuDevice(d: any) { gpuDevice = d; }

// Basemap styles
function makeRasterStyle(tiles: string[], attribution: string): any {
  return {
    version: 8,
    sources: {
      basemap: {
        type: "raster",
        tiles,
        tileSize: 256,
        maxzoom: 19,
        attribution,
      },
    },
    layers: [{ id: "basemap", type: "raster", source: "basemap" }],
  };
}

export const BASEMAP_STYLES: Record<string, any> = {
  light: makeRasterStyle(
    ["https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png"],
    "\u00a9 OpenStreetMap contributors \u00a9 CARTO"
  ),
  dark: makeRasterStyle(
    ["https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png"],
    "\u00a9 OpenStreetMap contributors \u00a9 CARTO"
  ),
  osm: makeRasterStyle(
    ["https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png"],
    "\u00a9 OpenStreetMap contributors \u00a9 CARTO"
  ),
  satellite: makeRasterStyle(
    [
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    ],
    "\u00a9 Esri"
  ),
};
