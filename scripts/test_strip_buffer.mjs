// Confirm one-shot fetch + fromArrayBuffer reduces request count to 1.
import { createServer } from "http";
import { statSync, createReadStream as fsCreateReadStream } from "fs";
import { fromArrayBuffer } from "geotiff";

const filepath = process.argv[2];
const stat = statSync(filepath);
const fileSize = stat.size;

let totalRequests = 0;
const server = createServer((req, res) => {
  totalRequests++;
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Accept-Ranges", "bytes");
  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Content-Length": end - start + 1,
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

console.time("fetch");
const resp = await fetch(url);
const buf = await resp.arrayBuffer();
console.timeEnd("fetch");

console.time("fromArrayBuffer+readRasters");
const tiff = await fromArrayBuffer(buf);
const image = await tiff.getImage();
const rasters = await image.readRasters({ width: 3600, height: 3600 });
console.timeEnd("fromArrayBuffer+readRasters");

console.log("OK:", rasters.length, "band(s),", rasters[0].length, "pixels");
console.log("server requests:", totalRequests);
server.close();
