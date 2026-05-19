#!/bin/bash
# Create a strip-layout GeoTIFF from a remote COG for testing.
# Demonstrates that deck.gl-raster's COGLayer fails on non-tiled GeoTIFFs.
#
# Usage: ./scripts/make-strip-test.sh [output.tif]
# Requires: GDAL (gdal_translate, gdalinfo)

set -e

SRC="/vsicurl/https://s2downloads.eox.at/demo/EOxCloudless/2020/rgb_corrected_geodetic/3/0/0.tif"
OUT="${1:-strip_test.tif}"

echo "Source: $SRC"
echo "Reading a small window and writing as strip-layout GeoTIFF..."

# Read a 512x512 window from the COG and write as strip-layout (no tiling)
gdal_translate \
  -srcwin 0 0 512 512 \
  -co TILED=NO \
  -co COMPRESS=DEFLATE \
  "$SRC" "$OUT"

echo ""
echo "Created: $OUT"
echo ""
gdalinfo "$OUT" | grep -E "Size|Block|Band|Driver"
echo ""
echo "This file uses strip layout (Block=512x1 or similar)."
echo "deck.gl-raster's COGLayer will fail with:"
echo '  Error: GeoTIFF must be tiled to generate a TMS.'
