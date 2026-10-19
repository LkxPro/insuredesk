import { REGION_CENTERS_TEXT } from "./region-centers-data";

export type LngLat = readonly [number, number];

function parseCenters(): ReadonlyMap<string, LngLat> {
  const centers = new Map<string, LngLat>();
  for (const line of REGION_CENTERS_TEXT.split("\n")) {
    if (!line) {
      continue;
    }
    const [code = "", lng = "", lat = ""] = line.split(",");
    centers.set(code, [Number(lng), Number(lat)]);
  }
  return centers;
}

export const REGION_CENTERS: ReadonlyMap<string, LngLat> = parseCenters();
