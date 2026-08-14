import type { Issue } from "./gh.ts";

export interface FrontierIssue {
  number: number;
  labels: string[];
  openBlockers: number;
  touchSet: string[];
  logicalLocks: string[];
  contractValid: boolean;
  serialOnly: boolean;
}

export interface FrontierPlan {
  selected: number[];
  skipped: Array<{ number: number; reason: string }>;
}

function section(body: string | undefined, heading: string): string {
  const lines = (body ?? "").split("\n");
  const start = lines.findIndex(
    (line) =>
      line.trim().toLowerCase() === `### ${heading}`.toLowerCase() ||
      line.trim().toLowerCase() === `## ${heading}`.toLowerCase(),
  );
  if (start === -1) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{2,3}\s/.test(line));
  return rest
    .slice(0, end === -1 ? undefined : end)
    .join("\n")
    .trim();
}

function list(value: string): string[] {
  return value
    .split("\n")
    .map((line) =>
      line
        .trim()
        .replace(/^[-*]\s+/, "")
        .replace(/^`|`$/g, ""),
    )
    .filter((line) => line && line.toLowerCase() !== "none");
}

function literalPrefix(pattern: string): string {
  const normalized = pattern.trim().replace(/^\.\//, "");
  const magic = normalized.search(/[?*[{(]/);
  if (magic === -1) return normalized.replace(/\/$/, "");
  return normalized
    .slice(0, magic)
    .replace(/[^/]*$/, "")
    .replace(/\/$/, "");
}

function normalizePattern(pattern: string): string {
  return pattern.trim().replace(/^\.\//, "").replace(/\/$/, "");
}

// `*` 不跨 `/`，`**` 跨任意深度，其余字符按字面处理。
export function globMatcher(pattern: string): RegExp {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern.charAt(index);
    if (character === "*" && pattern.charAt(index + 1) === "*") {
      source += ".*";
      index += 1;
    } else if (character === "*") source += "[^/]*";
    else source += character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

function patternsOverlap(a: string, b: string): boolean {
  const aGlob = a.includes("*");
  const bGlob = b.includes("*");
  if (!aGlob && !bGlob) return normalizePattern(a) === normalizePattern(b);
  if (!aGlob) return globMatcher(normalizePattern(b)).test(normalizePattern(a));
  if (!bGlob) return globMatcher(normalizePattern(a)).test(normalizePattern(b));
  const aPrefix = literalPrefix(a);
  const bPrefix = literalPrefix(b);
  return (
    !aPrefix ||
    !bPrefix ||
    aPrefix === bPrefix ||
    aPrefix.startsWith(`${bPrefix}/`) ||
    bPrefix.startsWith(`${aPrefix}/`)
  );
}

export function touchSetsOverlap(left: string[], right: string[]): boolean {
  return left.some((a) => right.some((b) => patternsOverlap(a, b)));
}

export function outsideTouchSet(patterns: string[], files: string[]): string[] {
  const matchers = patterns.map((pattern) => globMatcher(pattern.replace(/^\.\//, "")));
  return files.filter((file) => !matchers.some((candidate) => candidate.test(file)));
}

export function normalizeIssue(issue: Issue): FrontierIssue {
  const issueLabels = issue.labels.map((label) => (typeof label === "string" ? label : label.name));
  const acceptance = section(issue.body, "Acceptance criteria");
  const testPlan = list(section(issue.body, "Test plan"));
  const goal = section(issue.body, "Goal");
  const scope = section(issue.body, "Scope");
  const dependencies = section(issue.body, "Dependencies");
  return {
    number: issue.number,
    labels: issueLabels,
    openBlockers: issue.issue_dependencies_summary?.blocked_by ?? 0,
    touchSet: list(section(issue.body, "Declared touch-set")),
    logicalLocks: list(section(issue.body, "Logical locks")),
    contractValid:
      issueLabels.includes("agent:task") &&
      Boolean(goal) &&
      Boolean(scope) &&
      /- \[[ xX]\]/.test(acceptance) &&
      testPlan.length > 0 &&
      Boolean(dependencies),
    serialOnly: issueLabels.includes("serial-only"),
  };
}

export function planFrontier(issues: FrontierIssue[], maxParallel: number): FrontierPlan {
  const running = issues.filter((issue) => issue.labels.includes("agent:running"));
  const queued = issues.filter(
    (issue) => issue.labels.includes("agent:queued") && issue.labels.includes("ready-for-agent"),
  );
  const heldLocks = new Set(running.flatMap((issue) => issue.logicalLocks));
  const heldTouchSets = running.map((issue) => ({ number: issue.number, paths: issue.touchSet }));
  const available = Math.max(0, maxParallel - running.length);
  const selected: number[] = [];
  const skipped: Array<{ number: number; reason: string }> = [];

  if (running.some((issue) => issue.serialOnly)) return { selected, skipped };

  const validQueued = queued.filter((issue) => {
    if (issue.openBlockers > 0) {
      skipped.push({ number: issue.number, reason: "blocked-by-dependency" });
      return false;
    }
    if (!issue.contractValid) {
      skipped.push({ number: issue.number, reason: "invalid-contract" });
      return false;
    }
    if (issue.touchSet.length === 0) {
      skipped.push({ number: issue.number, reason: "invalid-touch-set" });
      return false;
    }
    return true;
  });

  const serial = running.length === 0 ? validQueued.find((issue) => issue.serialOnly) : null;
  if (serial) return { selected: [serial.number], skipped };

  for (const issue of validQueued.filter((candidate) => !candidate.serialOnly)) {
    const lock = issue.logicalLocks.find((candidate) => heldLocks.has(candidate));
    if (lock) {
      skipped.push({ number: issue.number, reason: `logical-lock:${lock}` });
      continue;
    }
    const overlap = heldTouchSets.find((held) => touchSetsOverlap(issue.touchSet, held.paths));
    if (overlap) {
      skipped.push({ number: issue.number, reason: `touch-set:${overlap.number}` });
      continue;
    }
    if (selected.length >= available) {
      skipped.push({ number: issue.number, reason: "capacity" });
      continue;
    }
    selected.push(issue.number);
    for (const candidate of issue.logicalLocks) heldLocks.add(candidate);
    heldTouchSets.push({ number: issue.number, paths: issue.touchSet });
  }
  return { selected, skipped };
}
