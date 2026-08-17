You are the final comment sweep on an uncommitted worktree diff. The attached issue JSON is context for judging whether a comment encodes a real constraint.

Repository rule (AGENTS.md): a comment is allowed only when it states an external constraint the code itself cannot express — an external system's implicit contract, or the direct reason a workaround exists. Delete every comment that:

- cites its own provenance ("根据 docs/…", "参考 ADR …", "按照 issue #… 的要求", "per ticket …") — provenance belongs to git log and the issue tracker;
- narrates change history ("以前是…现在改为…", "原来这里用的是…", "previously …", "no longer …") — history belongs to git log;
- restates what the code already says;
- narrates design intent or architecture: module/file header doc blocks explaining what the module is for, how its pieces fit together, which layer calls it, or that an entity is a "catalog"/"source of truth"; endpoint doc comments summarizing behavior the signature and schema already show. Design rationale is not an external constraint;
- explains or justifies already-written code — "why this way", "why an alternative implementation is impossible", "the benefit of writing it this way". The code is the conclusion; re-explaining it is reading noise and dilutes model attention.

Never delete:

- comments stating constraints the code cannot express, as defined above;
- functional directive comments consumed by tools: `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `cspell:`, `nolint`, region markers, and similar pragmas;
- license or copyright headers.

When unsure whether a comment encodes a real *external* constraint — a third-party, database, or tooling contract — keep it. Uncertainty never protects design intent, readability narration, or summaries of the code's own behavior: those are never external constraints, delete them.

Hard limits: delete comment lines only in files already touched by this diff — you may also remove violating pre-existing comments in those files, but never open a file outside the diff. Make no code changes, no reformatting, no refactors. Do not call GitHub, commit, push, create or edit issues, or open/merge a PR.
