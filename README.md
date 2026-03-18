# RasterEye

A VS Code / Positron extension for quickly viewing GeoTIFF files. Powered by [deck.gl-raster](https://github.com/developmentseed/deck.gl-raster) for GPU-accelerated COG rendering, [deck.gl](https://deck.gl), and [MapLibre GL JS](https://maplibre.org).

## Features

- **Open any `.tif` / `.tiff` file** directly in VS Code as a map viewer
- **Base layers** — Light, Dark, OpenStreetMap, Satellite
- **Transparency slider** — adjust raster opacity 0-100%
- **Single band rendering** with colormap selection:
  - Viridis, Magma, Inferno, Plasma, Turbo, Cividis
  - Spectral, RdYlBu, RdYlGn (diverging)
  - Hot, Greys, Terrain, Coolwarm
- **RGB / False color composites** — assign any band to R, G, B channels
- **Value range controls** — adjust min/max for contrast stretching
- **Auto CRS reprojection** — GPU mesh-based reprojection via deck.gl-raster
- **Native COG tiling** — streams tiles via HTTP range requests with automatic overview selection
- **GPU-accelerated** — rendering pipeline powered by deck.gl-raster's `COGLayer`

## Development

```bash
npm install
npm run build     # one-shot build
npm run watch     # rebuild on changes
```

## Packaging

```bash
npm run package   # produces rastereye-0.1.0.vsix
```

Install the `.vsix` in VS Code / Positron via *Extensions > Install from VSIX*.
