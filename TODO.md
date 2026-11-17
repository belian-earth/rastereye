# TODO

Items left open after the November 2026 review.

- **Strip-layout files still decode through geotiff.js.** deck.gl-raster 0.10
  reads tiled files only (developmentseed/deck.gl-raster issue 573). When
  strip reading lands upstream, `webview/strip.ts` can read pixels through
  `@developmentseed/geotiff` and the `geotiff` dependency can be dropped.
- **EPSG codes missing from the bundled table need epsg.io.** epsg.io is
  tried first; the bundled proj4-list table (about 5,400 codes, last updated
  February 2025) is the offline fallback. Newer codes such as GDA2020 MGA
  zones are not in it.
- **Pixel-interleaved multi-band LERC tiles are unpacked locally.**
  `@developmentseed/geotiff` 0.10 returns them as one packed array labelled
  as a single band; `tilePixels` in `webview/extract.ts` splits it. Report
  upstream and remove the workaround once fixed.
- **Palettes other than 256 entries** (16-bit colour tables) are drawn
  through a colormap, not their own colours.
- **Zarr support (follow-up).** `@developmentseed/deck.gl-zarr` 0.10 can draw
  Zarr through the same pipeline. Plan: a right-click "Open in RasterEye"
  command on `.zarr` folders that opens a standalone panel; serve the store
  directory from the file server under one token with a path-traversal
  guard; pass synthesised GeoZarr metadata to `ZarrSource.open` for
  GDAL-written stores (transform from the X/Y coordinate arrays, CRS from
  attributes or `pam.aux.xml`). Start with a spike on a single-resolution
  store to check that chunk layout makes it usable.
- **Native-projection view.** deck.gl-raster previews rendering in the
  raster's own CRS, but it depends on deck.gl v10 (alpha only) and MapLibre
  has no matching basemap. Revisit when deck.gl v10 is released.
- **`scripts/`** holds strip-layout repro scripts written against the
  geotiff.js v2 API. They are no longer packaged; update or remove them.
