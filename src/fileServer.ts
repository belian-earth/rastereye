import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

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
  "/webview.css": "webview.css",
};

/** Parsed byte range, or "invalid" (unsatisfiable → 416) or null (malformed →
 *  ignore the header per RFC 9110 and serve the full file). */
type ParsedRange = { start: number; end: number } | "invalid" | null;

export function parseRangeHeader(
  range: string,
  fileSize: number
): ParsedRange {
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!m || (m[1] === "" && m[2] === "")) {
    return null;
  }
  if (fileSize === 0) {
    return "invalid";
  }
  let start: number;
  let end: number;
  if (m[1] === "") {
    // Suffix range: last N bytes
    const n = parseInt(m[2], 10);
    if (n === 0) {
      return "invalid";
    }
    start = Math.max(0, fileSize - n);
    end = fileSize - 1;
  } else {
    start = parseInt(m[1], 10);
    // Clamp overshooting ends to EOF: geotiff.js requests block-aligned
    // ranges whose last block routinely extends past the file.
    end = m[2] === "" ? fileSize - 1 : Math.min(parseInt(m[2], 10), fileSize - 1);
  }
  if (start >= fileSize || start > end) {
    return "invalid";
  }
  return { start, end };
}

export class FileServer {
  private server: http.Server | null = null;
  private port = 0;
  private files = new Map<string, string>(); // id -> absolute filepath
  private idsByPath = new Map<string, string>(); // absolute filepath -> id
  private distDir: string;

  constructor(extensionPath?: string) {
    this.distDir = extensionPath
      ? path.join(extensionPath, "dist")
      : path.join(__dirname, "..");
  }

  async start(): Promise<void> {
    this.server = http.createServer((req, res) => {
      try {
        this.handleRequest(req, res);
      } catch (err) {
        // Never let a bad request take down the extension host.
        console.error("[RasterEye] fileServer request failed:", err);
        if (!res.headersSent) {
          res.writeHead(500);
        }
        res.end();
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

  private handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): void {
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

    // GeoTIFF file serving (by unguessable token) with range request support
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

    const parsed = range ? parseRangeHeader(range, fileSize) : null;
    if (parsed === "invalid") {
      res.writeHead(416, { "Content-Range": `bytes */${fileSize}` });
      res.end();
      return;
    }
    if (parsed) {
      const { start, end } = parsed;
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Content-Length": end - start + 1,
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
  }

  /** Register a file and return its HTTP URL. The URL uses a random token
   *  rather than anything path-derived: the server answers any local process,
   *  so a guessable ID would let arbitrary local webpages read open TIFFs. */
  registerFile(filepath: string): string {
    let id = this.idsByPath.get(filepath);
    if (!id) {
      id = crypto.randomBytes(16).toString("base64url");
      this.idsByPath.set(filepath, id);
      this.files.set(id, filepath);
    }
    return `http://127.0.0.1:${this.port}/${id}`;
  }

  /** Unregister a file when the document is closed */
  unregisterFile(filepath: string): void {
    const id = this.idsByPath.get(filepath);
    if (id) {
      this.idsByPath.delete(filepath);
      this.files.delete(id);
    }
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
