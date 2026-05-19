# Strip-layout GeoTIFF: COGLayer fails with "GeoTIFF must be tiled"

## Problem

`COGLayer` (and the underlying `@developmentseed/geotiff`) only supports tiled GeoTIFFs. When given a strip-layout file, it throws:

```
Error: GeoTIFF must be tiled to generate a TMS.
```

This is a common file format — GDAL's default `GTiff` output uses strip layout unless `-co TILED=YES` is specified.

## Reproduce

### 1. Create a strip-layout test file from a known COG

```bash
# Uses /vsicurl/ to read directly from the EOxCloudless COG example
gdal_translate \
  -srcwin 0 0 512 512 \
  -co TILED=NO \
  -co COMPRESS=DEFLATE \
  "/vsicurl/https://s2downloads.eox.at/demo/EOxCloudless/2020/rgb_corrected_geodetic/3/0/0.tif" \
  strip_test.tif

# Verify it's strip-layout
gdalinfo strip_test.tif | grep Block
# Band 1 Block=512x5 Type=Byte, ColorInterp=Red
```

### 2. Serve it locally and try to load with COGLayer

```bash
# Simple HTTP server with range request support
python3 -m http.server 8080
```

```javascript
import { COGLayer } from "@developmentseed/deck.gl-geotiff";

const layer = new COGLayer({
  id: "test",
  geotiff: "http://localhost:8080/strip_test.tif",
  onGeoTIFFLoad: (tiff, opts) => {
    console.log("Loaded:", tiff.isTiled); // false
    // Tiles will never render — _parseGeoTIFF throws before onGeoTIFFLoad
  },
});
```

### 3. Error thrown

```
Uncaught (in promise) Error: GeoTIFF must be tiled to generate a TMS.
    at TileMatrixSetTileset (tms.js)
    at COGLayer._parseGeoTIFF (cog-layer.js)
```

The error occurs in `_parseGeoTIFF` when it tries to create a `TileMatrixSetTileset` from the GeoTIFF, which requires `tileSize` — but `@cogeotiff/core`'s `TiffImage.tileSize` throws `"Tiff is not tiled"` for strip-layout files.

## Where the issue is

1. **`@cogeotiff/core` `TiffImage.tileSize`** (tiff.image.js:345) — throws for non-tiled files
2. **`@developmentseed/geotiff` `fetchTile`** (fetch.js:144) — calls `tileSize`, throws `"Tiff is not tiled"`
3. **`COGLayer._parseGeoTIFF`** — tries to create TMS from tile dimensions, propagates the error

The `TiffImage` class does have `getStrip(index)` and `stripCount` for reading strips, but the higher-level `fetchTile` and `COGLayer` don't use them.

## Possible approaches

1. **`GeoTIFFLayer`** — the non-tiled layer exists in the codebase but throws `"Loading GeoTIFF image data not yet implemented"`
2. **Synthetic tiling in `fetchTile`** — read strips and assemble into tile-sized chunks
3. **Full-image read for small files** — if `!isTiled`, read the entire image via strips and serve as a single tile

## Workaround

Users can convert to tiled format:
```bash
gdal_translate -co TILED=YES input.tif output.tif
# or for COG:
gdal_translate -of COG input.tif output.tif
```

## Context

This was discovered while building [RasterEye](https://github.com/belian-earth/rastereye), a VS Code/Positron extension for viewing GeoTIFFs. We work around it by detecting strip-layout files and falling back to `geotiff.js` + `BitmapLayer`, but native support in deck.gl-raster would be much better.
