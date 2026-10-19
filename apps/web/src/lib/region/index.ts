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

/** 地图页专用：中心点表、叶子边界与省界底图都走懒加载 chunk，不进入首屏。 */
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

/**
 * 单省视图的下一级边界（市；直辖市/港澳为区县），按省各自懒加载。
 * 无下级边界数据的省（台湾）返回 null，调用方退回省轮廓。
 */
export async function loadProvinceCityMap(
  provinceCode: string,
): Promise<ChinaProvincesGeoJson | null> {
  const load = PROVINCE_CITY_MAPS[`./provinces/${provinceCode}.geo.json`];
  return load ? (await load()).default : null;
}

/** 区县码 → 所属市码：前四位 + "00"（已核实对全部区县成立）；市级叶子即其自身。 */
export function cityCodeOf(locationCode: string): string {
  return `${locationCode.slice(0, 4)}00`;
}
