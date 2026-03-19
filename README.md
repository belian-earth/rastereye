# RasterEye

Quick GeoTIFF viewer for VS Code and Positron. Click a `.tif` file, see it on a map.

![RasterEye demo](docs/demo.gif)

> Local files only. Powered by [deck.gl-raster](https://github.com/developmentseed/deck.gl-raster), [deck.gl](https://deck.gl), and [MapLibre GL JS](https://maplibre.org).

## Features

- Single band with colormaps (Viridis, Magma, Inferno, Plasma, Turbo, Spectral, and more)
- 3-band composites (assign any band to R, G, B)
- Auto 2nd/98th percentile stretch with manual min/max override
- Scale/offset and band description metadata from GDAL tags
- Base layers: Light, Dark, OSM Voyager, Satellite
- Opacity slider, collapsible control panel
- Auto CRS reprojection, COG + standard tiled GeoTIFF support

## Install

Download the latest `.vsix` from [Releases](https://github.com/h-a-graham/rastereye/releases), then:

```bash
code --install-extension rastereye-*.vsix
# or: positron --install-extension rastereye-*.vsix
```

Or via the UI: Extensions sidebar > `...` > *Install from VSIX*.

## Build from Source

```bash
git clone https://github.com/h-a-graham/rastereye.git
cd rastereye
make              # installs deps, builds, and packages
```

Without Make: `npm install && npm run build && npm run package`

Install the result: `code --install-extension rastereye-*.vsix`

<details>
<summary>All Make targets</summary>

| Command | Description |
|---------|-------------|
| `make` | Install, build, and package |
| `make build` | Build extension + webview |
| `make package` | Create `.vsix` |
| `make watch` | Live rebuild on save |
| `make clean` | Remove build artifacts |
| `make rebuild` | Clean rebuild from scratch |

</details>

## License

MIT
