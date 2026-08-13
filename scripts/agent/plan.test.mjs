import assert from "node:assert/strict";
import test from "node:test";
import { renderTickets, validatePlan } from "./plan.mjs";

function ticket(key, overrides = {}) {
  return {
    key,
    title: `Ticket ${key}`,
    goal: `Deliver ${key}`,
    acceptanceCriteria: [`${key} works`],
    outOfScope: ["unrelated cleanup"],
    touchSet: [`area/${key}/**`],
    logicalLocks: [],
    testPlan: [`test ${key}`],
    dependsOn: [],
    serialOnly: false,
    ...overrides,
  };
}

test("validates and renders an ordered ticket DAG", () => {
  const plan = {
    tickets: [
      ticket("base"),
      ticket("next", { touchSet: ["area/base/file.ts"], dependsOn: ["base"] }),
    ],
  };
  assert.deepEqual(validatePlan(plan), []);
  assert.match(renderTickets(plan, 42)[1].body, /<!-- agent-plan:42:next -->/);
});

test("rejects unordered overlap, cycles, and incomplete contracts", () => {
  const plan = {
    tickets: [
      ticket("a", { touchSet: ["apps/web/**"], dependsOn: ["b"] }),
      ticket("b", { touchSet: ["apps/api/**"], dependsOn: ["a"] }),
      ticket("c", { touchSet: ["apps/web/src/app.tsx"], testPlan: [] }),
    ],
  };
  assert.deepEqual(validatePlan(plan), [
    "ticket c needs non-empty testPlan",
    "dependency graph contains a cycle",
    "tickets a and c conflict without dependency ordering",
  ]);
});
