import { pathToFileURL } from "node:url";

function section(body, heading) {
  const lines = (body ?? "").split("\n");
  const start = lines.findIndex(
    (line) =>
      line.trim().toLowerCase() === `### ${heading}`.toLowerCase() ||
      line.trim().toLowerCase() === `## ${heading}`.toLowerCase(),
  );
  if (start === -1) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^##{2,3}\s/.test(line));
  return rest
    .slice(0, end === -1 ? undefined : end)
    .join("\n")
    .trim();
}

function list(value) {
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

function labels(issue) {
  return issue.labels.map((label) => (typeof label === "string" ? label : label.name));
}

function literalPrefix(pattern) {
  const normalized = pattern.trim().replace(/^\.\//, "");
  const magic = normalized.search(/[?*[{(]/);
  if (magic === -1) return normalized.replace(/\/$/, "");
  return normalized
    .slice(0, magic)
    .replace(/[^/]*$/, "")
    .replace(/\/$/, "");
}

export function touchSetsOverlap(left, right) {
  return left.some((a) =>
    right.some((b) => {
      const aPrefix = literalPrefix(a);
      const bPrefix = literalPrefix(b);
      return (
        !aPrefix ||
        !bPrefix ||
        aPrefix === bPrefix ||
        aPrefix.startsWith(`${bPrefix}/`) ||
        bPrefix.startsWith(`${aPrefix}/`)
      );
    }),
  );
}

export function normalizeIssue(issue) {
  const issueLabels = labels(issue);
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

export function planFrontier(issues, maxParallel) {
  const running = issues.filter((issue) => issue.labels.includes("agent:running"));
  const queued = issues.filter(
    (issue) => issue.labels.includes("agent:queued") && issue.labels.includes("ready-for-agent"),
  );
  const heldLocks = new Set(running.flatMap((issue) => issue.logicalLocks));
  const heldTouchSets = running.map((issue) => ({ number: issue.number, paths: issue.touchSet }));
  const available = Math.max(0, maxParallel - running.length);
  const selected = [];
  const skipped = [];

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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const maxParallel = Number.parseInt(process.argv[2] ?? "4", 10);
  if (!Number.isInteger(maxParallel) || maxParallel < 1)
    throw new Error("maxParallel must be positive");
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) input += chunk;
  const issues = JSON.parse(input).map(normalizeIssue);
  process.stdout.write(`${JSON.stringify(planFrontier(issues, maxParallel))}\n`);
}
