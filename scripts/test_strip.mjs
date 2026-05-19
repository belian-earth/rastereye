import { fromArrayBuffer } from "geotiff";
import { readFileSync } from "fs";

const buf = readFileSync(process.argv[2]).buffer;
console.log("file bytes:", buf.byteLength);

const tiff = await fromArrayBuffer(buf);
const image = await tiff.getImage();
console.log("size:", image.getWidth(), "x", image.getHeight());
console.log("isTiled:", image.isTiled);
console.log("spp:", image.getSamplesPerPixel());
console.log("blockWidth:", image.getBlockWidth());
console.log("blockHeight:", image.getBlockHeight());
const fd = image.fileDirectory;
console.log("strip count:", (fd.StripOffsets ?? fd.TileOffsets)?.length);
console.log("compression:", fd.Compression);
console.log("sampleFormat:", fd.SampleFormat);
console.log("BitsPerSample:", fd.BitsPerSample);

console.time("readRasters");
const rasters = await image.readRasters();
console.timeEnd("readRasters");
console.log("bands:", rasters.length, "first band length:", rasters[0].length);
console.log("OK");
