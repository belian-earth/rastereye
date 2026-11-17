/// deck.gl layer for a strip-layout raster held fully in memory.
///
/// Draws the image with deck.gl-raster's RasterLayer, which warps it from the
/// file's CRS onto the map with an adaptive mesh, and colours it with the same
/// GPU pipeline as tiled files. The band texture is rebuilt only when
/// `textureKey` changes (band selection or render mode); colormap, range and
/// opacity changes re-emit the pipeline without touching the texture.

import { CompositeLayer } from "@deck.gl/core";
import type { Layer, UpdateParameters } from "@deck.gl/core";
import { RasterLayer } from "@developmentseed/deck.gl-raster";
import {
  buildBandTexture, buildRgbaBandsTexture,
  buildSinglebandPipeline, build3bandPipeline, getColormapTexture,
} from "./gpu-pipeline";

export interface StripLayerProps {
  id: string;
  opacity?: number;
  bands: ArrayLike<number>[];
  width: number;
  height: number;
  /// Must be reference-stable: a new object regenerates the mesh.
  reprojectionFns: any;
  mode: "singleband" | "3band";
  singleBand: number;
  bandR: number;
  bandG: number;
  bandB: number;
  /// Changes whenever the texture contents must be rebuilt.
  textureKey: string;
  /// Changes whenever the render pipeline's inputs change.
  pipelineKey: string;
}

export class StripLayer extends CompositeLayer<StripLayerProps> {
  static layerName = "StripLayer";

  declare state: {
    texture: any;
    textureKey: string | null;
    colormapTexture: any;
    finalized: boolean;
  };

  initializeState(): void {
    this.state = {
      texture: null, textureKey: null, colormapTexture: null, finalized: false,
    };
    getColormapTexture(this.context.device).then((colormapTexture) => {
      if (!this.state.finalized) this.setState({ colormapTexture });
    });
  }

  updateState({ props }: UpdateParameters<this>): void {
    if (props.textureKey === this.state.textureKey) return;
    const old = this.state.texture;
    const { bands, width, height } = props;
    const px = { bands };
    const device = this.context.device;
    const texture = props.mode === "3band"
      ? buildRgbaBandsTexture(
          device, px, width, height, bands.length,
          props.bandR, props.bandG, props.bandB,
        )
      : buildBandTexture(device, px, width, height, bands.length, props.singleBand);
    this.setState({ texture, textureKey: props.textureKey });
    // The previous texture may still be bound for the frame in flight.
    if (old) setTimeout(() => old.destroy(), 500);
  }

  finalizeState(context: any): void {
    super.finalizeState(context);
    this.state.finalized = true;
    this.state.texture?.destroy();
  }

  renderLayers(): Layer | null {
    const { texture, colormapTexture } = this.state;
    if (!texture) return null;
    const { width, height, reprojectionFns, mode } = this.props;
    let renderPipeline: any[];
    if (mode === "3band") {
      renderPipeline = build3bandPipeline(texture);
    } else if (colormapTexture) {
      renderPipeline = buildSinglebandPipeline(texture, colormapTexture);
    } else {
      return null;
    }
    return new RasterLayer(this.getSubLayerProps({
      id: "raster",
      width,
      height,
      reprojectionFns,
      renderPipeline,
      // Mesh vertices are longitude/latitude; deck.gl projects them.
      coordinateSystem: "lnglat",
      updateTriggers: { renderPipeline: [this.props.pipelineKey] },
    }));
  }
}
