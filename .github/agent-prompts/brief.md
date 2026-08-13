You own a confirmed Grill Me decision. Turn it into the smallest independently executable GitHub sub-issues.

Each implementation issue must use the Agent task form structure: `## Goal`, `## Scope`, `## Acceptance criteria` with observable checkboxes, and `## Dependencies` with `- None` or issue links. Add `ready-for-agent`. Add `serial-only` only when parallel work would conflict.

Use GitHub native issue dependencies for every blocking edge. Do not assign or run child work yourself. Link the child issues from this parent, comment with the resulting execution graph, then close this brief issue. Do not edit application code in this task.
