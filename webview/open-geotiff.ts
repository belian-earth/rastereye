/// Tiled GeoTIFF opening with a known file size.
///
/// `GeoTIFF.fromUrl` in @developmentseed/geotiff seeds its HTTP source with an
/// infinite size (a workaround for S3, which does not expose Content-Range to
/// browsers). With no size, neither cogeotiff's header read nor the chunk
/// middleware can clamp reads to the end of the file. If the IFD sits in the
/// file's final bytes (GDAL relocates it there when tags are rewritten in
/// place), the 16 KB header read is rounded up to 64 KB chunks and one chunk
/// starts past EOF. Our file server correctly answers 416, and the whole open
/// rejects. See TODO.md for the upstream fix.
///
/// RasterEye only ever loads through its own file server, which exposes
/// Content-Range, so we can learn the true size with a one-byte range request
/// and seed the source ourselves. Everything downstream (chunk and cache
/// middleware, COGLayer, deck.gl-raster) is unchanged.

import { GeoTIFF } from "@developmentseed/geotiff";
import { SourceHttp } from "@chunkd/source-http";
import { SourceView } from "@chunkd/source";
import { SourceCache, SourceChunk } from "@chunkd/middleware";

// Match @developmentseed/geotiff's fromUrl defaults so tile and header
// request patterns stay identical to the upstream path.
const CHUNK_SIZE = 64 * 1024;
const CACHE_SIZE = 8 * 1024 * 1024;

/// Derive the file size from range-response headers. Prefers the total in
/// Content-Range ("bytes 0-0/12345"); falls back to Content-Length only for
/// a full (200) response, since on a 206 it is the length of the part, not
/// the file. Returns null when the size cannot be determined.
export function fileSizeFromHeaders(
  status: number,
  contentRange: string | null,
  contentLength: string | null,
): number | null {
  if (contentRange) {
    const m = /^bytes\s+(?:\d+-\d+|\*)\/(\d+)$/i.exec(contentRange.trim());
    if (m) {
      const size = Number(m[1]);
      if (Number.isFinite(size) && size >= 0) return size;
    }
  }
  if (status === 200 && contentLength) {
    const size = Number(contentLength);
    if (Number.isFinite(size) && size >= 0) return size;
  }
  return null;
}

/// Probe the file size with a one-byte range request.
async function probeFileSize(url: string): Promise<number | null> {
  const resp = await fetch(url, { headers: { Range: "bytes=0-0" } });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
  }
  return fileSizeFromHeaders(
    resp.status,
    resp.headers.get("content-range"),
    resp.headers.get("content-length"),
  );
}

/// Open a tiled GeoTIFF for COGLayer with the source's size seeded from the
/// server, so header reads are clamped to the file. If the size cannot be
/// read, fall back to the library's own fromUrl (unbounded size) rather than
/// failing outright.
export async function openGeoTIFF(url: string): Promise<any> {
  const size = await probeFileSize(url);
  if (size == null) {
    console.warn(
      "[RasterEye] File size unavailable from range headers; falling back to GeoTIFF.fromUrl",
    );
    return GeoTIFF.fromUrl(url);
  }

  const source = new SourceHttp(url, {});
  source.metadata = { size };
  const headerSource = new SourceView(source, [
    new SourceChunk({ size: CHUNK_SIZE }),
    new SourceCache({ size: CACHE_SIZE }),
  ]);
  return GeoTIFF.open({ dataSource: source, headerSource });
}
