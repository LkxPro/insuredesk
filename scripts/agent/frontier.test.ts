import assert from "node:assert/strict";
import test from "node:test";
import { type FrontierIssue, normalizeIssue, planFrontier, touchSetsOverlap } from "./frontier.ts";

function issue(number: number, overrides: Partial<FrontierIssue> = {}): FrontierIssue {
  return {
    number,
    labels: ["ready-for-agent", "agent:queued"],
    openBlockers: 0,
    touchSet: [`area/${number}/**`],
    logicalLocks: [],
    contractValid: true,
    serialOnly: false,
    ...overrides,
  };
}

test("selects an independent dependency-free frontier up to capacity", () => {
  const result = planFrontier([issue(1), issue(2), issue(3)], 2);
  assert.deepEqual(result.selected, [1, 2]);
});

test("running tickets reserve capacity, touch-sets, and logical locks", () => {
  const result = planFrontier(
    [
      issue(9, { labels: ["agent:running"], touchSet: ["apps/api/**"], logicalLocks: ["schema"] }),
      issue(1, { touchSet: ["apps/api/src/index.ts"] }),
      issue(2, { logicalLocks: ["schema"] }),
      issue(3),
    ],
    3,
  );
  assert.deepEqual(result.selected, [3]);
  assert.deepEqual(result.skipped, [
    { number: 1, reason: "touch-set:9" },
    { number: 2, reason: "logical-lock:schema" },
  ]);
});

test("glob touch-sets reserve wildcard intersections with glob-vs-glob prefix conservatism", () => {
  assert.equal(touchSetsOverlap(["**"], ["apps/api/**"]), true);
  assert.equal(touchSetsOverlap(["apps/api/**"], ["apps/web/**"]), false);
  assert.equal(touchSetsOverlap(["docs/api/**"], ["docs/**/api/**"]), true);
});

test("literal paths against globs use real glob semantics", () => {
  assert.equal(touchSetsOverlap(["*.md"], ["docs/readme.md"]), false);
  assert.equal(touchSetsOverlap(["*.md"], ["readme.md"]), true);
  assert.equal(touchSetsOverlap(["docs/**/*.md"], ["docs/runbook.txt"]), false);
  assert.equal(touchSetsOverlap(["docs/**/*.md"], ["docs/guide/readme.md"]), true);
  assert.equal(touchSetsOverlap(["apps/api/**"], ["apps/api/src/index.ts"]), true);
  assert.equal(touchSetsOverlap(["apps/*"], ["apps/api/src/index.ts"]), false);
});

test("literal paths overlap only when identical", () => {
  assert.equal(touchSetsOverlap(["apps/a.ts"], ["apps/a.ts"]), true);
  assert.equal(touchSetsOverlap(["apps/a.ts"], ["apps/b.ts"]), false);
  assert.equal(touchSetsOverlap(["apps"], ["apps/x.ts"]), false);
});

test("blocks dependencies and makes serial-only exclusive", () => {
  const result = planFrontier(
    [issue(1, { openBlockers: 1 }), issue(2, { serialOnly: true }), issue(3)],
    4,
  );
  assert.deepEqual(result.selected, [2]);
  assert.deepEqual(result.skipped, [{ number: 1, reason: "blocked-by-dependency" }]);
});

test("a running serial-only ticket blocks the whole frontier", () => {
  const result = planFrontier(
    [issue(9, { labels: ["agent:running"], serialOnly: true }), issue(1)],
    4,
  );
  assert.deepEqual(result.selected, []);
});

test("only complete implementation tickets enter the frontier", () => {
  const malformed = normalizeIssue({
    number: 43,
    state: "OPEN",
    body: "## Declared touch-set\n- apps/api/**",
    labels: [{ name: "ready-for-agent" }, { name: "agent:queued" }, { name: "agent:task" }],
  });
  const untyped = normalizeIssue({
    number: 44,
    state: "OPEN",
    body: "## Goal\nGoal\n## Scope\nScope\n## Declared touch-set\n- apps/api/**\n## Acceptance criteria\n- [ ] done\n## Dependencies\n- None\n## Test plan\n- test",
    labels: [{ name: "ready-for-agent" }, { name: "agent:queued" }],
  });
  const result = planFrontier([malformed, untyped], 4);
  assert.deepEqual(result.selected, []);
  assert.deepEqual(result.skipped, [
    { number: 43, reason: "invalid-contract" },
    { number: 44, reason: "invalid-contract" },
  ]);
});

test("sections terminate at ## headings: locks and touch-set stay clean", () => {
  // publisher 渲染七段全用 ##;Logical locks 后面的 ## 必须截段落,
  // 否则 locks 吞掉后续 heading,同批票因假 lock 冲突无法并行。
  const parsed = normalizeIssue({
    number: 45,
    state: "OPEN",
    body: [
      "## Goal",
      "Goal",
      "## Scope",
      "Scope",
      "## Declared touch-set",
      "- apps/api/**",
      "## Logical locks",
      "- None",
      "## Acceptance criteria",
      "- [ ] done",
      "## Test plan",
      "- test",
      "## Dependencies",
      "- None",
    ].join("\n"),
    labels: [{ name: "ready-for-agent" }, { name: "agent:queued" }, { name: "agent:task" }],
  });
  assert.deepEqual(parsed.logicalLocks, []);
  assert.deepEqual(parsed.touchSet, ["apps/api/**"]);
  assert.equal(parsed.contractValid, true);
});
