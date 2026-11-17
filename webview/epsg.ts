/// EPSG code resolution with an offline fallback.
///
/// epsg.io is tried first because its PROJJSON definitions are the most
/// complete. If it cannot be reached, the code is looked up in a bundled
/// table of proj4 strings (proj4-list), so a raster in a common projected
/// CRS still opens without a network connection.

import proj4 from "proj4";
import proj4List from "proj4-list";
import { epsgResolver } from "@developmentseed/proj";
import type { ProjectionDefinition } from "@developmentseed/proj";

const TIMEOUT_MS = 8000;

/// Definition from the bundled table, or null when the code is not listed.
export function offlineDefinition(code: number): ProjectionDefinition | null {
  const entry = (proj4List as Record<string, [string, string]>)[`EPSG:${code}`];
  if (!entry) return null;
  // Let proj4 parse the string into the definition object the projection
  // helpers expect (projName, units, datum parameters).
  const key = `RASTEREYE:${code}`;
  proj4.defs(key, entry[1]);
  return proj4.defs(key) as unknown as ProjectionDefinition;
}

export async function resolveEpsg(code: number): Promise<ProjectionDefinition> {
  try {
    return await Promise.race([
      epsgResolver(code),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("epsg.io timed out")), TIMEOUT_MS)),
    ]);
  } catch (err) {
    const offline = offlineDefinition(code);
    if (offline) {
      console.warn(`[RasterEye] epsg.io unavailable; using bundled definition for EPSG:${code}`);
      return offline;
    }
    console.error(`[RasterEye] EPSG:${code} lookup failed:`, err);
    throw new Error(
      `Could not resolve EPSG:${code}: epsg.io is unreachable and the code is not in the offline table.`,
    );
  }
}
