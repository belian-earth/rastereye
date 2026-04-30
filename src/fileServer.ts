import * as http from "http";
import * as fs from "fs";
import * as path from "path";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

const STATIC_ROUTES: Record<string, string> = {
  "/viewer": "viewer.html",
  "/viewer.html": "viewer.html",
  "/webview.js": "webview.js",
  "/webview.js.map": "webview.js.map",
};

export class FileServer {
  private server: http.Server | null = null;
  private port = 0;
  private files = new Map<string, string>(); // id -> absolute filepath
  private distDir: string;

  constructor(extensionPath?: string) {
    this.distDir = extensionPath
      ? path.join(extensionPath, "dist")
      : path.join(__dirname, "..");
  }

  async start(): Promise<void> {
    this.server = http.createServer((req, res) => {
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

      // Static assets
      const staticFile = STATIC_ROUTES[pathname];
      if (staticFile) {
        return this.serveStatic(res, staticFile);
      }

      // GeoTIFF file serving (by base64url ID) with range request support
      const fileId = pathname.slice(1);
      const filepath = this.files.get(fileId);
      if (!filepath) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      let stat: fs.Stats;
      try {
        stat = fs.statSync(filepath);
      } catch {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

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
        pipeFile(fs.createReadStream(filepath, { start, end }), res);
      } else {
        res.writeHead(200, {
          "Content-Length": fileSize,
          "Content-Type": "application/octet-stream",
        });
        pipeFile(fs.createReadStream(filepath), res);
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

  /** Unregister a file when the document is closed */
  unregisterFile(filepath: string): void {
    const id = Buffer.from(filepath).toString("base64url");
    this.files.delete(id);
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

    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      res.writeHead(404);
      res.end(`${filename} not found`);
      return;
    }

    const ext = path.extname(filename);
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": stat.size,
      "Cache-Control": "no-cache",
    });
    pipeFile(fs.createReadStream(filePath), res);
  }
}

/** Pipe a file stream to a response, swallowing the EPIPE / aborted-request
 *  errors that occur when the client (e.g. an aborted tile fetch) drops
 *  mid-stream. Without these handlers Node escalates the error to SIGPIPE. */
function pipeFile(
  stream: fs.ReadStream,
  res: http.ServerResponse,
): void {
  const cleanup = () => stream.destroy();
  res.on("close", cleanup);
  stream.on("error", () => res.destroy());
  stream.pipe(res);
}
