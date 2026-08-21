## Communication Language
When reporting information to me, be extremely concise and sacrifice grammar for the sake of concision.

## Pull Request

- 提交 PR 前必须清注释：仅保留「外部系统隐含契约/怪癖、业务 invariant/负空间约束、workaround 的直接原因」，禁止 JSDoc 复述代码、章节 banner、变更历史、未来计划、教程式/散文式论证，其余一律删除
- 提交 PR 前顺手清掉改动文件里的遗留无用注释（逐步收紧仓库内无关注释存量）

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues (`LkxPro/insuredesk`) via the `gh` CLI. External PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Default label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` at the repo root. See `docs/agents/domain.md`.

## Automated issue work

- Run Grill Me interactively in local Claude or Codex. GitHub Issues begin only after the human confirms the design.
- `too-spec` is optional: large efforts publish a parent spec first; small confirmed tasks may go straight `too-tickets` with parent `0`.
- For `too-spec`, publish the confirmed Markdown with `scripts/agent/publish-spec.sh`; never add `ready-for-agent` to the parent spec.
- For `too-tickets`, emit the structured schema accepted by `scripts/agent/plan.mjs`, then call `scripts/agent/publish-tickets.sh`. The publisher owns child bodies, labels, sub-issue links, and native dependency edges. Parentless plans share the `agent-plan:0:*` marker namespace — prefix keys with an area.
- `ready-for-agent` requires acceptance criteria, declared touch-set, logical locks, tests, and native dependency edges.
- The declared touch-set is the parallel-scheduling contract, not a hard boundary. Workers may make minimal out-of-set changes when acceptance criteria require them, and must report every out-of-set file in the final report.
- Autonomous worker model processes leave an uncommitted diff only. They never call GitHub, commit, push, or open/merge PRs; the controller owns publication. Interactive `too-spec`/`too-tickets` sessions may read Issues with `gh` and may mutate GitHub only through their deterministic publisher scripts.
- Run focused tests during work and `make check` before handoff. Never weaken a quality gate.
- On ambiguity or unsafe migration, apply `agent:blocked` with evidence; do not guess.
- Executor and state-machine details: `docs/agents/agent-loop.md`.
