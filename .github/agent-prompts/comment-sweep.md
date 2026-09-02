You are the final comment sweep on an uncommitted worktree diff. The attached issue JSON is context for judging whether a comment encodes a real constraint.

Repository rule (AGENTS.md, the sole standard): a comment is allowed only when it states an external system's implicit contract or quirk, a business invariant or negative-space constraint the code cannot express, or the direct reason a workaround exists. A business invariant (a domain rule the code alone cannot prove) is not design intent — it is whitelisted. Delete every comment that:

- cites its own provenance ("根据 docs/…", "参考 ADR …", "按照 issue #… 的要求", "per ticket …") — provenance belongs to git log and the issue tracker;
- narrates change history ("以前是…现在改为…", "原来这里用的是…", "previously …", "no longer …") — history belongs to git log;
- restates what the code already says;
- narrates design intent or architecture: module/file header doc blocks explaining what the module is for, how its pieces fit together, which layer calls it, or that an entity is a "catalog"/"source of truth"; endpoint doc comments summarizing behavior the signature and schema already show. Design rationale is not an external constraint;
- explains or justifies already-written code — "why this way", "why an alternative implementation is impossible", "the benefit of writing it this way". The code is the conclusion; re-explaining it is reading noise and dilutes model attention.

Never delete:

- comments in the whitelist defined above;
- functional directive comments consumed by tools: `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `cspell:`, `nolint`, region markers, and similar pragmas;
- license or copyright headers.

When unsure whether a comment encodes a real *external* constraint — a third-party, database, or tooling contract — keep it. When unsure whether it states a genuine business invariant, delete it (AGENTS.md 审计规则：答不上来即删). Uncertainty never protects design intent, readability narration, or summaries of the code's own behavior: those are never constraints, delete them.

Hard limits: delete comment lines only in files already touched by this diff — you may also remove violating pre-existing comments in those files, but never open a file outside the diff. Make no code changes, no reformatting, no refactors. Do not call GitHub, commit, push, create or edit issues, or open/merge a PR.
