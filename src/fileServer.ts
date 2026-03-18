import * as http from "http";
import * as fs from "fs";
import * as path from "path";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

export class FileServer {
  private server: http.Server | null = null;
  private port = 0;
  private files = new Map<string, string>(); // id → absolute filepath
  private distDir: string;

  constructor(extensionPath?: string) {
    // dist/ is a sibling of src/ in the extension root
    this.distDir = extensionPath
      ? path.join(extensionPath, "dist")
      : path.join(__dirname, "..");
  }

  async start(): Promise<void> {
    this.server = http.createServer((req, res) => {
      // CORS headers
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Range, Cache, Cache-Control, Content-Type, If-None-Match"
      );
      res.setHeader(
        "Access-Control-Expose-Headers",
        "Content-Range, Content-Length, Accept-Ranges"
      );

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url || "/", `http://127.0.0.1:${this.port}`);
      const pathname = url.pathname;

      // Static assets: /viewer, /webview.js, /webview.js.map
      if (pathname === "/viewer" || pathname === "/viewer.html") {
        return this.serveStatic(res, "viewer.html");
      }
      if (pathname === "/webview.js") {
        return this.serveStatic(res, "webview.js");
      }
      if (pathname === "/webview.js.map") {
        return this.serveStatic(res, "webview.js.map");
      }

      // GeoTIFF file serving (by ID) with range request support
      const fileId = pathname.slice(1); // strip leading /
      const filepath = this.files.get(fileId);

      if (!filepath || !fs.existsSync(filepath)) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const stat = fs.statSync(filepath);
      const fileSize = stat.size;
      const range = req.headers.range;

      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Cache-Control", "no-cache");

      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunkSize = end - start + 1;

        res.writeHead(206, {
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Content-Length": chunkSize,
          "Content-Type": "application/octet-stream",
        });
        fs.createReadStream(filepath, { start, end }).pipe(res);
      } else {
        res.writeHead(200, {
          "Content-Length": fileSize,
          "Content-Type": "application/octet-stream",
        });
        fs.createReadStream(filepath).pipe(res);
      }
    });

    return new Promise((resolve) => {
      this.server!.listen(0, "127.0.0.1", () => {
        const addr = this.server!.address();
        if (addr && typeof addr === "object") {
          this.port = addr.port;
        }
        resolve();
      });
    });
  }

  /** Register a file and return its HTTP URL */
  registerFile(filepath: string): string {
    const id = Buffer.from(filepath).toString("base64url");
    this.files.set(id, filepath);
    return `http://127.0.0.1:${this.port}/${id}`;
  }

  /** Get the full viewer URL for a file */
  getViewerUrl(filepath: string): string {
    const fileUrl = this.registerFile(filepath);
    const name = path.basename(filepath);
    return `http://127.0.0.1:${this.port}/viewer?file=${encodeURIComponent(fileUrl)}&name=${encodeURIComponent(name)}`;
  }

  getPort(): number {
    return this.port;
  }

  dispose(): void {
    this.server?.close();
    this.server = null;
  }

  private serveStatic(res: http.ServerResponse, filename: string): void {
    const filePath = path.join(this.distDir, filename);
    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end(`${filename} not found`);
      return;
    }
    const ext = path.extname(filename);
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    const stat = fs.statSync(filePath);
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": stat.size,
      "Cache-Control": "no-cache",
    });
    fs.createReadStream(filePath).pipe(res);
  }
}
