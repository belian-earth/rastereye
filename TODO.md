# TODO

## Upstream: `GeoTIFF.fromUrl` requests byte ranges past end of file

**Package:** `@developmentseed/geotiff` (0.7.0), `dist/geotiff.js`, `fromUrl`.
**Related:** deck.gl-raster issue 524, which the current code cites as the reason for the workaround.

### Problem

`fromUrl` seeds its HTTP source with `metadata = { size: Infinity }` so that
`@chunkd/source-http` never records a size. The intent is to survive S3, where
the browser cannot read `Content-Range` (not in `Access-Control-Expose-Headers`)
and the `Content-Length` fallback would record a single chunk's length as the
file size.

With an infinite size, two guards are disabled:

- `getMaxLength` in `@cogeotiff/core` no longer shortens a header read that
  would cross end of file.
- `SourceChunk.fetchChunks` in `@chunkd/middleware` no longer clamps the last
  chunk, so a read that crosses a 64 KB chunk boundary near EOF emits a request
  for a chunk that starts past the end of the file.

Any RFC 9110 server answers that request with 416. `SourceHttp.fetch` throws on
a non-OK status, and the whole open rejects.

Trigger: an IFD within 16 KB of end of file, positioned so that
`ifdOffset + 16 KB` crosses into a chunk beginning at or after the file size.
GDAL produces this layout whenever tags are rewritten in place after creation
(band descriptions, statistics, nodata), because it appends a new directory at
the end of the file. Files with the COG layout keep their directories at the
start and are unaffected.

Reproduction: `ESD_dk_2017.tif`, 4,972,969 bytes, first IFD at 4,972,240.
Opening it via `fromUrl` against RasterEye's file server fails with
`Failed to fetch ... bytes=4980736-5046271` (416).

### Local workaround (in place)

`webview/open-geotiff.ts` opens tiled files itself: a `bytes=0-0` request reads
the true size from `Content-Range`, the `SourceHttp` is seeded with it, and
`GeoTIFF.open` is called with the same chunk and cache middleware `fromUrl`
uses. COGLayer accepts the resulting instance unchanged. This is safe here
because RasterEye only loads through its own server, which exposes
`Content-Range`.

### Suggested upstream fix

Keep the S3 workaround but stop treating the size as unknown once it is
knowable. Two complementary changes:

1. **Use `Content-Range` when it is readable.** In `fromUrl`, seed the size from
   the first range response's `Content-Range` total when present, and fall
   back to `Infinity` only when the header is not exposed. This restores the
   `getMaxLength` and `SourceChunk` clamps for every server that exposes the
   header, which includes any correctly configured S3 bucket.

2. **Tolerate a 416 on a trailing chunk.** In `SourceChunk.fetchChunks` (or a
   wrapper in `fromUrl`), when the size is unknown and a chunk request returns
   416, treat that chunk as empty rather than failing the whole read. The
   header parser already handles short buffers, so a truncated read at EOF is
   equivalent to a clamped one. This covers the case where `Content-Range` is
   hidden and the file happens to have its IFD near the end.

Either change alone fixes the reproduction above; both together make the
library robust regardless of server headers. When either lands upstream,
`open-geotiff.ts` can be deleted and `tiled.ts` can pass the URL to COGLayer
again.
