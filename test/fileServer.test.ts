import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FileServer } from "../src/fileServer";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("FileServer", () => {
  let server: FileServer;
  let testFilePath: string;
  let testFileContent: Buffer;

  beforeAll(async () => {
    // Create a temp file to serve
    testFilePath = path.join(os.tmpdir(), `rastereye-test-${Date.now()}.bin`);
    testFileContent = Buffer.from("Hello, RasterEye! This is test data.");
    fs.writeFileSync(testFilePath, testFileContent);

    server = new FileServer();
    await server.start();
  });

  afterAll(() => {
    server.dispose();
    try {
      fs.unlinkSync(testFilePath);
    } catch {
      // ignore
    }
  });

  it("starts on a random port", () => {
    expect(server.getPort()).toBeGreaterThan(0);
    expect(server.getPort()).toBeLessThan(65536);
  });

  it("registerFile returns a localhost URL", () => {
    const url = server.registerFile(testFilePath);
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/.+/);
  });

  it("registerFile returns consistent URLs for the same file", () => {
    const url1 = server.registerFile(testFilePath);
    const url2 = server.registerFile(testFilePath);
    expect(url1).toBe(url2);
  });

  it("serves a registered file", async () => {
    const url = server.registerFile(testFilePath);
    const res = await fetch(url);
    expect(res.status).toBe(200);
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(testFileContent)).toBe(true);
  });

  it("returns Content-Length header", async () => {
    const url = server.registerFile(testFilePath);
    const res = await fetch(url);
    expect(res.headers.get("content-length")).toBe(
      String(testFileContent.length)
    );
  });

  it("returns Accept-Ranges: bytes", async () => {
    const url = server.registerFile(testFilePath);
    const res = await fetch(url);
    expect(res.headers.get("accept-ranges")).toBe("bytes");
  });

  it("supports range requests", async () => {
    const url = server.registerFile(testFilePath);
    const res = await fetch(url, {
      headers: { Range: "bytes=0-4" },
    });
    expect(res.status).toBe(206);
    const body = await res.text();
    expect(body).toBe("Hello");
    expect(res.headers.get("content-range")).toMatch(
      /^bytes 0-4\/\d+$/
    );
  });

  it("supports range requests for middle of file", async () => {
    const url = server.registerFile(testFilePath);
    const res = await fetch(url, {
      headers: { Range: "bytes=7-15" },
    });
    expect(res.status).toBe(206);
    const body = await res.text();
    expect(body).toBe("RasterEye");
  });

  it("returns 404 for unregistered files", async () => {
    const port = server.getPort();
    const res = await fetch(`http://127.0.0.1:${port}/nonexistent`);
    expect(res.status).toBe(404);
  });

  it("returns CORS headers", async () => {
    const url = server.registerFile(testFilePath);
    const res = await fetch(url);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("handles OPTIONS preflight", async () => {
    const url = server.registerFile(testFilePath);
    const res = await fetch(url, { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("unregisterFile removes access", async () => {
    const tempFile = path.join(
      os.tmpdir(),
      `rastereye-unreg-${Date.now()}.bin`
    );
    fs.writeFileSync(tempFile, "temp");
    const url = server.registerFile(tempFile);

    // Should work before unregister
    const res1 = await fetch(url);
    expect(res1.status).toBe(200);

    // Unregister
    server.unregisterFile(tempFile);

    // Should 404 after unregister
    const res2 = await fetch(url);
    expect(res2.status).toBe(404);

    fs.unlinkSync(tempFile);
  });

  it("serves static viewer.html if dist exists", async () => {
    const port = server.getPort();
    const res = await fetch(`http://127.0.0.1:${port}/viewer`);
    // May 404 if dist/viewer.html doesn't exist in test env — that's fine
    expect([200, 404]).toContain(res.status);
    if (res.status === 200) {
      expect(res.headers.get("content-type")).toMatch(/text\/html/);
    }
  });
});
