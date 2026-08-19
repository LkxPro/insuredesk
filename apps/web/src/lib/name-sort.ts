import { pinyin } from "pinyin-pro";

export type NameSortDir = "asc" | "desc";

function pinyinKey(name: string): string {
  return pinyin(name, { toneType: "none", type: "array" }).join(" ");
}

export function compareByName(a: string, b: string): number {
  const byPinyin = pinyinKey(a).localeCompare(pinyinKey(b));
  if (byPinyin !== 0) return byPinyin;
  return a.localeCompare(b, "zh-Hans-CN");
}

export function sortByName<T extends { name: string }>(rows: readonly T[], dir: NameSortDir): T[] {
  const sorted = [...rows].sort((x, y) => compareByName(x.name, y.name));
  return dir === "desc" ? sorted.reverse() : sorted;
}
