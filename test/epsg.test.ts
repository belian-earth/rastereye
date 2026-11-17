import { describe, it, expect, vi, afterEach } from "vitest";
import proj4 from "proj4";
import { offlineDefinition, resolveEpsg } from "../webview/epsg";

afterEach(() => vi.unstubAllGlobals());

describe("offlineDefinition", () => {
  it("returns a usable definition for a common projected CRS", () => {
    const def: any = offlineDefinition(27700);
    expect(def.projName).toBe("tmerc");
    expect(def.units).toBe("m");
    // British National Grid origin area: Exeter is near (292000, 92000).
    const [lng, lat] = proj4(def, "EPSG:4326").forward([292000, 92000]);
    expect(lng).toBeCloseTo(-3.53, 1);
    expect(lat).toBeCloseTo(50.72, 1);
  });

  it("returns null for an unlisted code", () => {
    expect(offlineDefinition(999999)).toBeNull();
  });
});

describe("resolveEpsg", () => {
  it("falls back to the bundled table when epsg.io is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const def: any = await resolveEpsg(2180);
    expect(def.projName).toBe("tmerc");
  });

  it("reports an unresolvable code clearly", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(resolveEpsg(999999)).rejects.toThrow(/EPSG:999999/);
  });
});
