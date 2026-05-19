// Spin up a local HTTP server mimicking our extension's FileServer
// behavior, then fetch the file via geotiff.fromUrl to reproduce the
// "Failed to fetch" error path that hits in the webview.

import { createServer } from "http";
import { statSync, createReadStream as fsCreateReadStream } from "fs";
import { fromUrl } from "geotiff";

const filepath = process.argv[2];
const stat = statSync(filepath);
const fileSize = stat.size;

let totalRequests = 0;
let totalBytes = 0;
const server = createServer((req, res) => {
  totalRequests++;
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges");
  res.setHeader("Accept-Ranges", "bytes");
  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;
    totalBytes += chunkSize;
    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Content-Length": chunkSize,
      "Content-Type": "application/octet-stream",
    });
    fsCreateReadStream(filepath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      "Content-Length": fileSize,
      "Content-Type": "application/octet-stream",
    });
    fsCreateReadStream(filepath).pipe(res);
  }
});

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const url = `http://127.0.0.1:${port}/file`;
console.log("server:", url);

try {
  console.time("fromUrl");
  const tiff = await fromUrl(url);
  console.timeEnd("fromUrl");
  console.time("getImage");
  const image = await tiff.getImage();
  console.timeEnd("getImage");
  console.log("isTiled:", image.isTiled, "size:", image.getWidth(), image.getHeight());

  console.time("readRasters");
  const rasters = await image.readRasters({ width: 3600, height: 3600 });
  console.timeEnd("readRasters");
  console.log("OK:", rasters.length, "band(s),", rasters[0].length, "pixels");
} catch (e) {
  console.error("FAILED:", e.message);
  console.error(e.stack);
}
console.log("requests:", totalRequests, "bytes served:", totalBytes);
server.close();
