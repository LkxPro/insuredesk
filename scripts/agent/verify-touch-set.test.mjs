import assert from "node:assert/strict";
import test from "node:test";
import { outsideTouchSet } from "./verify-touch-set.mjs";

test("accepts declared files and rejects everything else", () => {
  assert.deepEqual(
    outsideTouchSet(["apps/api/**", "pnpm-lock.yaml"], ["apps/api/src/index.ts", "docs/readme.md"]),
    ["docs/readme.md"],
  );
});
