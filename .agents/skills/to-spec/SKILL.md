---
name: to-spec
description: Publish the confirmed outcome of an InsureDesk Grill Me conversation as a durable parent specification in GitHub Issues. Use after the human explicitly confirms the design and asks for to-spec; do not use for implementation tickets.
---

# Publish a confirmed specification

Do not ask new design questions. Synthesize only decisions already confirmed in the current conversation.

1. Read `CONTEXT.md`, relevant repository code, and existing tests.
2. Write a temporary Markdown file with exactly these headings:
   - `## Problem Statement`
   - `## Solution`
   - `## User Stories`
   - `## Implementation Decisions`
   - `## Testing Decisions`
   - `## Out of Scope`
   - `## Further Notes`
3. Make requirements observable and preserve explicit non-goals. Do not include unstable implementation snippets.
4. Run:

   ```sh
   sh scripts/agent/publish-spec.sh "Spec: <short title>" <temporary-markdown-file>
   ```

5. Return the parent Issue URL/number. Do not add `ready-for-agent`; the parent is a durable `agent:spec`, not executable work.

The publisher is idempotent for identical Markdown content. GitHub access is allowed only for this deterministic publisher command.
