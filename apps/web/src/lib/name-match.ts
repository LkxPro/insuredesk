import { match } from "pinyin-pro";

export type MatchRange = [number, number];
export type NameMatch = { ranges: MatchRange[] };

function indicesToRanges(indices: number[]): MatchRange[] {
  const ranges: MatchRange[] = [];
  for (const index of indices) {
    const last = ranges.at(-1);
    if (last && index === last[1]) {
      last[1] = index + 1;
    } else {
      ranges.push([index, index + 1]);
    }
  }
  return ranges;
}

function mergeRanges(ranges: MatchRange[]): MatchRange[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: MatchRange[] = [];
  for (const [start, end] of sorted) {
    const last = merged.at(-1);
    if (last && start <= last[1]) {
      last[1] = Math.max(last[1], end);
    } else {
      merged.push([start, end]);
    }
  }
  return merged;
}

export function matchName(name: string, query: string): NameMatch | null {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return { ranges: [] };
  }
  const ranges: MatchRange[] = [];
  for (const token of tokens) {
    const hit = match(name, token);
    if (!hit) {
      return null;
    }
    ranges.push(...indicesToRanges(hit));
  }
  return { ranges: mergeRanges(ranges) };
}
