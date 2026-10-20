import type { RegionNode } from "@insuredesk/shared/region";
import { matchName } from "@/lib/name-match";

/** 省、省+市、省+市+区县各成一条，路径即层级（直辖市为省+区县）。 */
export type RegionPath = readonly RegionNode[];

const SEPARATORS = /[\s,，、/\\>＞|·-]+/g;

export function regionPathLabel(path: RegionPath): string {
  return path.map((node) => node.name).join(" ");
}

export function flattenRegionPaths(provinces: readonly RegionNode[]): RegionPath[] {
  const paths: RegionPath[] = [];
  const visit = (node: RegionNode, parents: RegionPath) => {
    const path = [...parents, node];
    paths.push(path);
    for (const child of node.children) visit(child, path);
  };
  for (const province of provinces) visit(province, []);
  return paths;
}

function matchChinese(query: string, names: readonly string[]): boolean {
  const consume = (pos: number, level: number): boolean => {
    if (pos === query.length) return level === names.length;
    if (level === names.length) return false;
    const name = names[level] as string;
    for (let length = Math.min(name.length, query.length - pos); length >= 1; length -= 1) {
      if (query.startsWith(name.slice(0, length), pos) && consume(pos + length, level + 1)) {
        return true;
      }
    }
    return level < names.length - 1 && consume(pos, level + 1);
  };
  return consume(0, 0);
}

/** 拼音（全拼或首字母，空格分段）：末段须命中末级名称，全部分段须命中整条路径。 */
function matchPinyin(query: string, names: readonly string[]): boolean {
  const tokens = query.trim().split(/\s+/);
  const leaf = names.at(-1) ?? "";
  return matchName(leaf, tokens.at(-1) ?? "") !== null && matchName(names.join(""), query) !== null;
}

export function matchRegionPath(query: string, path: RegionPath): boolean {
  const names = path.map((node) => node.name);
  if (/^[a-z\s]+$/i.test(query.trim())) return matchPinyin(query, names);
  const compact = query.replace(SEPARATORS, "");
  return compact.length > 0 && matchChinese(compact, names);
}

export function searchRegionPaths(
  query: string,
  paths: readonly RegionPath[],
  limit = 50,
): RegionPath[] {
  const compact = query.replace(SEPARATORS, "");
  const exact = (path: RegionPath) => (path.map((node) => node.name).join("") === compact ? 0 : 1);
  return paths
    .filter((path) => matchRegionPath(query, path))
    .sort(
      (a, b) =>
        exact(a) - exact(b) ||
        a.length - b.length ||
        (a.at(-1)?.code ?? "").localeCompare(b.at(-1)?.code ?? ""),
    )
    .slice(0, limit);
}
