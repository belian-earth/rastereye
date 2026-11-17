/// GPU render pipelines for raster tiles.
///
/// Single-band: r32float texture → nodata filter → rescale → colormap.
/// 3-band composite: rgba32float texture (R/G/B from selected bands, A=1) →
/// nodata filter (R-only) → rescale.
///
/// In both cases scale/offset are pre-baked on CPU during extraction (cheap;
/// metadata is fixed for the lifetime of a tile) and `LinearRescale` bounds
/// are vmin/vmax in display units. Both modes also use a single GPU texture
/// per tile and the same `CreateTexture` sampler — keeping each tile's load
/// path short, so deck.gl's `no-overlap` strategy can swap quadrants snappily.

import {
  Colormap,
  COLORMAP_INDEX,
  CreateTexture,
  FilterNoDataVal,
  LinearRescale,
  createColormapTexture,
  decodeColormapSprite,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import colormapsPng from "@developmentseed/deck.gl-raster/gpu-modules/colormaps.png";
import {
  state, nodataValue, scalingActive, bandScales, bandOffsets,
} from "./state";
import { NODATA_SENTINEL, extractBand, extractRgba, TilePixels } from "./extract";
import { stretchBounds } from "./range";

let colormapTexturePromise: Promise<any> | null = null;

export async function getColormapTexture(device: any): Promise<any> {
  if (!colormapTexturePromise) {
    colormapTexturePromise = (async () => {
      // colormapsPng is a Uint8Array (esbuild "binary" loader), decoded
      // in memory so no request is needed.
      const imgData = await decodeColormapSprite(colormapsPng);
      return createColormapTexture(device, imgData);
    })();
  }
  return colormapTexturePromise;
}

/// Name of the colormap entry that draws a palette file with its own colours.
export const PALETTE = "palette";

/// The open file's colour table (256 RGBA entries), when it has one.
let palette: Uint8ClampedArray | null = null;
let paletteTexture: any = null;

export function setPalette(rgba: Uint8ClampedArray | null): void {
  palette = rgba;
  paletteTexture = null;
}

export function getPalette(): Uint8ClampedArray | null {
  return palette;
}

function getPaletteTexture(device: any): any {
  if (!paletteTexture && palette) {
    paletteTexture = createColormapTexture(device, new ImageData(
      palette as Uint8ClampedArray<ArrayBuffer>, 256, 1,
    ));
  }
  return paletteTexture;
}

export function colormapIndex(name: string): number {
  const idx = (COLORMAP_INDEX as Record<string, number>)[name];
  return idx ?? COLORMAP_INDEX.viridis;
}

/// Build an r32float single-channel texture from tile data (either layout),
/// extracting the chosen band, applying GDAL scale/offset, and folding
/// NaN / nodata values into a uniform sentinel for shader-side discard.
export function buildBandTexture(
  device: any,
  px: TilePixels,
  width: number,
  height: number,
  spp: number,
  bandIdx: number,
  mask?: ArrayLike<number> | null,
): any {
  const bi = Math.min(bandIdx, spp - 1);
  const scale = scalingActive ? (bandScales[bi] ?? 1) : 1;
  const offset = scalingActive ? (bandOffsets[bi] ?? 0) : 0;
  const bandData = extractBand(
    px, width * height, spp, bandIdx, nodataValue, scale, offset, mask,
  );

  return device.createTexture({
    data: bandData,
    width,
    height,
    format: "r32float",
    // r32float linear filtering requires OES_texture_float_linear which isn't
    // universally available. Nearest also keeps the nodata sentinel intact for
    // FilterNoDataVal's exact-match discard.
    sampler: { minFilter: "nearest", magFilter: "nearest" },
  });
}

/// Build a single rgba32float texture with the user-selected R/G/B bands
/// interleaved into the corresponding RGBA channels (alpha set to 1). Same
/// scale/offset baking and nodata-sentinel logic as `buildBandTexture`.
/// Single texture upload — same shape as single-band, just RGBA instead of R.
export function buildRgbaBandsTexture(
  device: any,
  px: TilePixels,
  width: number,
  height: number,
  spp: number,
  bandR: number,
  bandG: number,
  bandB: number,
  mask?: ArrayLike<number> | null,
): any {
  const ri = Math.min(bandR, spp - 1);
  const gi = Math.min(bandG, spp - 1);
  const bi = Math.min(bandB, spp - 1);

  const scaleOf = (b: number) => (scalingActive ? (bandScales[b] ?? 1) : 1);
  const offsetOf = (b: number) => (scalingActive ? (bandOffsets[b] ?? 0) : 0);

  const out = extractRgba(
    px, width * height, spp, bandR, bandG, bandB, nodataValue,
    [scaleOf(ri), scaleOf(gi), scaleOf(bi)],
    [offsetOf(ri), offsetOf(gi), offsetOf(bi)],
    mask,
  );

  return device.createTexture({
    data: out,
    width,
    height,
    format: "rgba32float",
    sampler: { minFilter: "nearest", magFilter: "nearest" },
  });
}

/// Render-time pipeline (single-band). Reads `state` for rescale/colormap;
/// callers must list those state fields in `updateTriggers.renderTile` so
/// deck.gl re-emits the pipeline when they change.
export function buildSinglebandPipeline(
  texture: any,
  colormapTexture: any,
): any[] {
  if (state.colormap === PALETTE && palette) {
    // Pixel values are indices into the file's colour table. Rescaling
    // [-0.5, 255.5] to [0, 1] lands index i on the centre of texel i, so the
    // lookup is exact and the value range controls do not apply.
    return [
      { module: CreateTexture, props: { textureName: texture } },
      { module: FilterNoDataVal, props: { value: NODATA_SENTINEL } },
      { module: LinearRescale, props: { rescaleMin: -0.5, rescaleMax: 255.5 } },
      {
        module: Colormap,
        props: { colormapTexture: getPaletteTexture(texture.device), colormapIndex: 0 },
      },
    ];
  }
  const [rescaleMin, rescaleMax] = stretchBounds();
  return [
    { module: CreateTexture, props: { textureName: texture } },
    { module: FilterNoDataVal, props: { value: NODATA_SENTINEL } },
    { module: LinearRescale, props: { rescaleMin, rescaleMax } },
    {
      module: Colormap,
      props: {
        colormapTexture,
        colormapIndex: colormapIndex(state.colormap),
        reversed: state.colormapReversed,
      },
    },
  ];
}

/// Render-time pipeline (3-band composite). Reads the RGBA texture directly:
/// `CreateTexture` puts (R-band, G-band, B-band, 1) into `color`, then the
/// nodata filter discards R-channel sentinel pixels and `LinearRescale`
/// applies the same vmin/vmax to all three channels (shared rescale, R-only
/// nodata).
export function build3bandPipeline(texture: any): any[] {
  const [rescaleMin, rescaleMax] = stretchBounds();
  return [
    { module: CreateTexture, props: { textureName: texture } },
    { module: FilterNoDataVal, props: { value: NODATA_SENTINEL } },
    { module: LinearRescale, props: { rescaleMin, rescaleMax } },
  ];
}

/// Decoded colormap sprite (256 px wide, one row per colormap) for the
/// control-panel preview, so the preview shows exactly what the GPU samples.
let spritePromise: Promise<ImageData> | null = null;
export function getColormapSprite(): Promise<ImageData> {
  if (!spritePromise) spritePromise = decodeColormapSprite(colormapsPng);
  return spritePromise;
}
