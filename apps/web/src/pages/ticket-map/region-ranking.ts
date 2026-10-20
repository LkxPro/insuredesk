import type { TicketMapLocation } from "@insuredesk/shared";
import type { RegionNode } from "@insuredesk/shared/region";
import type { RegionPath } from "./region-search";

export type RankLevel = "province" | "city" | "district";

export const RANK_LEVELS: readonly RankLevel[] = ["province", "city", "district"];

export const RANK_LEVEL_LABEL: Record<RankLevel, string> = {
  province: "省份",
  city: "城市",
  district: "区县",
};

export const RANK_LEVEL_SHORT: Record<RankLevel, string> = {
  province: "省",
  city: "市",
  district: "区县",
};

/** 直辖市与港澳：省下直接是区县，市排名里以省自身充当市。 */
function isMunicipality(province: RegionNode): boolean {
  return province.children[0]?.level === "district";
}

export function rankLevelsFor(scope: RegionPath): RankLevel[] {
  const [province, city] = scope;
  if (!province) return [...RANK_LEVELS];
  if (city) return ["district"];
  if (province.children.length === 0) return ["province"];
  return isMunicipality(province) ? ["district"] : ["city", "district"];
}

function nodeAtLevel(path: RegionPath, level: RankLevel): RegionNode | null {
  const [province] = path;
  if (!province) return null;
  if (level === "province") return province;
  const node = path.find((candidate) => candidate.level === level);
  if (node) return node;
  return level === "city" && isMunicipality(province) ? province : null;
}

export interface RankingRow {
  readonly code: string;
  readonly name: string;
  readonly parentLabel: string;
  readonly count: number;
  readonly rank: number;
  readonly path: RegionPath;
  /** 叶子区划才能按定位码跳转工单列表。 */
  readonly leaf: boolean;
}

export interface Ranking {
  readonly rows: readonly RankingRow[];
  readonly total: number;
  readonly excluded: number;
}

export function buildRegionRanking(
  locations: readonly TicketMapLocation[],
  level: RankLevel,
  scope: RegionPath,
  regionPath: (code: string) => RegionPath,
  isLocated: (code: string) => boolean,
): Ranking {
  const groups = new Map<string, { path: RegionPath; count: number }>();
  let excluded = 0;
  for (const location of locations) {
    if (location.count <= 0 || !isLocated(location.code)) continue;
    const path = regionPath(location.code);
    if (path.length === 0 || scope.some((node, index) => path[index]?.code !== node.code)) {
      continue;
    }
    const node = nodeAtLevel(path, level);
    if (!node) {
      excluded += location.count;
      continue;
    }
    const group = groups.get(node.code) ?? {
      path: path.slice(0, path.indexOf(node) + 1),
      count: 0,
    };
    group.count += location.count;
    groups.set(node.code, group);
  }

  const sorted = [...groups.values()].sort(
    (a, b) =>
      b.count - a.count || (a.path.at(-1)?.code ?? "").localeCompare(b.path.at(-1)?.code ?? ""),
  );
  const rows: RankingRow[] = [];
  let total = 0;
  for (const [index, { path, count }] of sorted.entries()) {
    const node = path.at(-1) as RegionNode;
    const previous = rows.at(-1);
    total += count;
    rows.push({
      code: node.code,
      name: node.name,
      parentLabel: path
        .slice(scope.length, -1)
        .map((parent) => parent.name)
        .join(" "),
      count,
      rank: previous?.count === count ? previous.rank : index + 1,
      path,
      leaf: node.children.length === 0,
    });
  }
  return { rows, total, excluded };
}
