import type { LngLat } from "./region-centers";
import type { Ring } from "./region-shapes";

export type { LngLat, Ring };

export interface ChinaProvincesGeoJson {
  readonly type: "FeatureCollection";
  readonly features: readonly {
    readonly type: "Feature";
    readonly properties: { readonly adcode: number | string; readonly name: string };
    readonly geometry: unknown;
  }[];
}

export interface MapRegionData {
  readonly centers: ReadonlyMap<string, LngLat>;
  readonly provinces: ChinaProvincesGeoJson;
  /** 叶子区划简化边界：红点落位的约束范围。 */
  readonly shapes: ReadonlyMap<string, readonly Ring[]>;
}

export async function loadMapRegionData(): Promise<MapRegionData> {
  const [{ REGION_CENTERS }, { REGION_SHAPES }, provinces] = await Promise.all([
    import("./region-centers"),
    import("./region-shapes"),
    import("./china-provinces.geo.json").then(
      (module) => module.default as unknown as ChinaProvincesGeoJson,
    ),
  ]);
  return { centers: REGION_CENTERS, provinces, shapes: REGION_SHAPES };
}

const PROVINCE_CITY_MAPS = import.meta.glob<{ default: ChinaProvincesGeoJson }>(
  "./provinces/*.geo.json",
);

export async function loadProvinceCityMap(
  provinceCode: string,
): Promise<ChinaProvincesGeoJson | null> {
  const load = PROVINCE_CITY_MAPS[`./provinces/${provinceCode}.geo.json`];
  return load ? (await load()).default : null;
}

export function cityCodeOf(locationCode: string): string {
  return `${locationCode.slice(0, 4)}00`;
}

const CITY_DISTRICT_MAPS = import.meta.glob<{ default: ChinaProvincesGeoJson }>(
  "./cities/*.geo.json",
);

export async function loadCityDistrictMap(cityCode: string): Promise<ChinaProvincesGeoJson | null> {
  const load = CITY_DISTRICT_MAPS[`./cities/${cityCode}.geo.json`];
  return load ? (await load()).default : null;
}
