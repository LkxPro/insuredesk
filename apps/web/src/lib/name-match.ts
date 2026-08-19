export type MatchRange = [number, number];
export type NameMatch = { score: number; ranges: MatchRange[] };

type Segment = { kind: "cjk" | "latin"; text: string };

const SEGMENT_RUN = /[㐀-鿿]+|[a-z0-9]+/g;

export function splitSegments(query: string): Segment[] {
  const segments: Segment[] = [];
  for (const token of query.toLowerCase().split(/\s+/).filter(Boolean)) {
    for (const part of token.match(SEGMENT_RUN) ?? []) {
      segments.push({ kind: /^[㐀-鿿]/.test(part) ? "cjk" : "latin", text: part });
    }
  }
  return segments;
}

type SegmentMatch = { score: number; start: number; end: number };

function matchCjk(name: string, text: string): SegmentMatch | null {
  const index = name.indexOf(text);
  return index < 0
    ? null
    : { score: 100 - 8 * index + 2 * text.length, start: index, end: index + text.length };
}

function matchLatin(py: string[], query: string): SegmentMatch | null {
  let best: SegmentMatch | null = null;
  const consider = (score: number, start: number, end: number) => {
    if (!best || score > best.score) {
      best = { score, start, end };
    }
  };
  for (let start = 0; start < py.length; start++) {
    let rest = query;
    let i = start;
    let matched = false;
    while (i < py.length) {
      const syllable = py[i];
      if (syllable === undefined) {
        break;
      }
      if (syllable.startsWith(rest)) {
        i++;
        matched = true;
        break;
      }
      if (rest.startsWith(syllable)) {
        rest = rest.slice(syllable.length);
        i++;
        continue;
      }
      break;
    }
    if (matched) {
      consider(60 - 8 * start + Math.min(2 * query.length, 20), start, i);
    }
    if (start + query.length <= py.length) {
      let initialsHit = true;
      for (let j = 0; j < query.length; j++) {
        if (py[start + j]?.[0] !== query[j]) {
          initialsHit = false;
          break;
        }
      }
      if (initialsHit) {
        consider(40 - 8 * start + query.length, start, start + query.length);
      }
    }
  }
  return best;
}

export function matchName(name: string, py: string[], query: string): NameMatch | null {
  const segments = splitSegments(query);
  if (segments.length === 0) {
    return { score: 0, ranges: [] };
  }
  let score = 0;
  const ranges: MatchRange[] = [];
  for (const segment of segments) {
    const hit =
      segment.kind === "cjk" ? matchCjk(name, segment.text) : matchLatin(py, segment.text);
    if (!hit) {
      return null;
    }
    score += hit.score;
    ranges.push([hit.start, hit.end]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  return { score, ranges };
}
