---
name: to-tickets
description: Convert a confirmed InsureDesk parent spec into complete executable GitHub child tickets with native dependency edges. Use when the human invokes to-tickets after to-spec; publication automatically queues the dependency-free frontier.
---

# Publish an executable ticket DAG

Do not interview or request another approval. The interactive Grill Me confirmation is the design decision point; invoking this skill authorizes ticket publication.

1. Read the complete parent `agent:spec` Issue and inspect the repository areas it affects.
2. Split the work into narrow, independently verifiable vertical slices. Maximize parallelism.
3. Write a temporary JSON file:

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

4. Use real repository-relative paths/globs. Put shared schemas, migrations, and contracts in `logicalLocks`. Add a dependency path between every pair whose touch-sets or locks overlap. Use `serialOnly` only when dependency ordering cannot isolate the conflict.
5. Run:

   ```sh
   sh scripts/agent/publish-tickets.sh <parent-issue-number> <temporary-json-file>
   ```

6. Return the created child numbers and dependency-free frontier.

The publisher validates the full plan before publication, renders Goal/Scope/Acceptance criteria/Declared touch-set/Logical locks/Dependencies/Test plan, creates sub-issue and native dependency links, then adds `agent:task`, `ready-for-agent`, and `agent:queued`. Never create or label the child Issues manually.
