You own a confirmed Grill Me decision. Turn it into a durable specification and the smallest independently executable GitHub sub-issues.

Write `docs/specs/issue-<n>/spec.md` with the confirmed decisions, requirements, non-goals, risks, rollout/rollback, verification, ticket graph, touch-set ownership, and logical locks. Write `docs/specs/issue-<n>/tickets.json` with `{ "tickets": [...] }`. Each ticket requires `key`, `title`, `goal`, non-empty arrays `acceptanceCriteria`, `outOfScope`, `touchSet`, `testPlan`, arrays `logicalLocks`, `dependsOn`, and boolean `serialOnly`.

Each implementation issue must use the Agent task form structure: `## Goal`, `## Scope`, `## Declared touch-set`, `## Logical locks`, `## Acceptance criteria` with observable checkboxes, and `## Dependencies` with `- None` or issue links. Add `ready-for-agent`. Maximize safe parallelism, but add a dependency path between tickets whose touch-sets or logical locks overlap. Add `serial-only` only when dependency ordering cannot isolate the conflict.

Do not edit outside `docs/specs/issue-<n>`, call GitHub, commit, push, create issues, or open/merge a PR. The controller validates and publishes the artifacts deterministically.
