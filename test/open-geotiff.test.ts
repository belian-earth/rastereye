import { describe, it, expect } from "vitest";
import { fileSizeFromHeaders } from "../webview/open-geotiff";

describe("fileSizeFromHeaders", () => {
  it("reads the total from Content-Range on a 206", () => {
    expect(fileSizeFromHeaders(206, "bytes 0-0/4972969", "1")).toBe(4972969);
  });

  it("accepts an unsatisfied-range form", () => {
    expect(fileSizeFromHeaders(416, "bytes */4972969", null)).toBe(4972969);
  });

  it("ignores Content-Length on a 206 (it is the part length, not the file)", () => {
    expect(fileSizeFromHeaders(206, null, "1")).toBeNull();
  });

  it("falls back to Content-Length on a full 200 response", () => {
    expect(fileSizeFromHeaders(200, null, "12345")).toBe(12345);
  });

  it("returns null for malformed or missing headers", () => {
    expect(fileSizeFromHeaders(206, "bytes 0-0/abc", null)).toBeNull();
    expect(fileSizeFromHeaders(206, "garbage", null)).toBeNull();
    expect(fileSizeFromHeaders(206, null, null)).toBeNull();
    expect(fileSizeFromHeaders(200, null, "-5")).toBeNull();
  });
});
