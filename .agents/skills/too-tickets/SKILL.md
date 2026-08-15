---
name: too-tickets
description: Convert confirmed InsureDesk design work into complete executable GitHub tickets with native dependency edges. Use after the human explicitly confirms the design — with a parent spec issue number, or 0 for parentless single tickets and small DAGs.
---

# Publish an executable ticket DAG

Publishing has two separate gates. Grill Me confirms the design; this skill confirms the split — invoking it is not authorization to publish. Draft the full breakdown, get the user's explicit approval (step 6), then publish.

1. If given a parent issue number, read the complete parent `agent:spec` Issue. If publishing parentless, the confirmed conversation context is the source of truth — no GitHub parent exists.
2. Inspect the repository areas the work affects.
3. Split only when a ticket would overflow one context window or the split buys real parallelism (independent touch-sets that can genuinely run at the same time). A single well-specified ticket is the default and always a valid DAG; each additional ticket must justify its coordination cost. Touch-set/lock overlaps still require dependency edges — that rule constrains splits, it never motivates them.
4. Write a temporary JSON file:

   ```json
   {
     "tickets": [
       {
         "key": "stable-kebab-key",
         "title": "Short outcome title",
         "goal": "User-visible outcome and reason",
         "acceptanceCriteria": ["Observable criterion"],
         "outOfScope": ["Explicit non-goal"],
         "touchSet": ["repository/relative/**"],
         "logicalLocks": [],
         "testPlan": ["Exact focused verification"],
         "dependsOn": [],
         "serialOnly": false
       }
     ]
   }
   ```

5. Use real repository-relative paths/globs. Put shared schemas, migrations, and contracts in `logicalLocks`. Add a dependency path between every pair whose touch-sets or locks overlap. Use `serialOnly` only when dependency ordering cannot isolate the conflict. Parentless tickets share a global `agent-plan:0:*` marker namespace: give keys an area prefix (e.g. `billing-retry-logic`) so unrelated parentless plans never collide.
6. Present the drafted breakdown for review: each ticket's title, `dependsOn`, one-line goal, and touch-set summary. Wait for explicit user approval — the earlier Grill Me design confirmation does not cover the split.
7. Run:

   ```sh
   sh scripts/agent/publish-tickets.sh <parent-issue-number|0> <temporary-json-file>
   ```

8. Return the created child numbers and dependency-free frontier.

The publisher validates the full plan before publication, renders Goal/Scope/Acceptance criteria/Declared touch-set/Logical locks/Dependencies/Test plan, creates native dependency links (and sub-issue links when a parent exists), then adds `agent:task`, `ready-for-agent`, and `agent:queued`. Never create or label the child Issues manually.
