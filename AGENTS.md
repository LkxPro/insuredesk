When reporting information to me, be extremely concise and sacrifice grammar for the sake of concision.

# InsureDesk

## 注释规范

注释只用来陈述代码本身无法表达的约束（为什么不能换一种写法、外部系统的隐含契约、workaround 的原因）。禁止以下注释：

- 引用出处："根据 docs/xxx"、"参考 ADR 0007 实现"、"按照 issue #43 的要求"
- 叙述变更历史："以前是…现在改为…"、"原来这里用的是…"——那是 git log 的职责
- Do not repeat what the code is already saying

注释密度、命名和惯用法向周边既有代码看齐。发现存量的冗余注释时顺手删除。

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues (`LkxPro/insuredesk`) via the `gh` CLI. External PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Default label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` at the repo root. See `docs/agents/domain.md`.

## Automated issue work

- `decision-confirmed` is the only normal human approval point. Never add it without explicit confirmation.
- `ready-for-agent` requires acceptance criteria, declared touch-set, logical locks, tests, and native dependency edges.
- Change only the declared touch-set. New scope requires a ticket update and a fresh claim.
- Model processes leave an uncommitted diff only. Never call GitHub, commit, push, or open/merge PRs; the controller owns publication.
- Run focused tests during work and `make check` before handoff. Never weaken a quality gate.
- On ambiguity or unsafe migration, apply `agent:blocked` with evidence; do not guess.
- Executor and state-machine details: `docs/agents/agent-loop.md`.
