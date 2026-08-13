import assert from "node:assert/strict";
import test from "node:test";
import { normalizeIssue, planFrontier, touchSetsOverlap } from "./frontier.mjs";

function issue(number, overrides = {}) {
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

test("glob touch-sets conservatively reserve wildcard intersections", () => {
  assert.equal(touchSetsOverlap(["**"], ["apps/api/**"]), true);
  assert.equal(touchSetsOverlap(["*.md"], ["docs/readme.md"]), true);
  assert.equal(touchSetsOverlap(["docs/**/*.md"], ["docs/runbook.txt"]), true);
  assert.equal(touchSetsOverlap(["apps/api/**"], ["apps/web/**"]), false);
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

test("planning briefs receive scheduler-owned scope while malformed tasks fail closed", () => {
  const brief = normalizeIssue({
    number: 42,
    body: "confirmed decision",
    labels: [{ name: "agent:queued" }, { name: "agent:brief" }],
  });
  const malformed = normalizeIssue({
    number: 43,
    body: "## Declared touch-set\n- apps/api/**",
    labels: [{ name: "ready-for-agent" }, { name: "agent:queued" }, { name: "agent:task" }],
  });
  const untyped = normalizeIssue({
    number: 44,
    body: "## Goal\nGoal\n## Scope\nScope\n## Declared touch-set\n- apps/api/**\n## Acceptance criteria\n- [ ] done\n## Dependencies\n- None\n## Test plan\n- test",
    labels: [{ name: "ready-for-agent" }, { name: "agent:queued" }],
  });
  const result = planFrontier([brief, malformed, untyped], 4);
  assert.deepEqual(result.selected, [42]);
  assert.deepEqual(result.skipped, [
    { number: 43, reason: "invalid-contract" },
    { number: 44, reason: "invalid-contract" },
  ]);
});
