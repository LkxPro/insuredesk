When reporting information to me, be extremely concise and sacrifice grammar for the sake of concision.

# InsureDesk

## 注释规范

注释只用来陈述代码本身无法表达的约束（为什么不能换一种写法、外部系统的隐含契约、workaround 的原因）。禁止以下注释：

- 引用出处："根据 docs/xxx"、"参考 ADR 0007 实现"、"按照 issue #43 的要求"
- 叙述变更历史："以前是…现在改为…"、"原来这里用的是…"——那是 git log 的职责
- 复述下一行代码在做什么
- Do not repeat what the code is already saying

注释密度、命名和惯用法向周边既有代码看齐。发现存量的冗余注释时顺手删除。

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues (`LkxPro/insuredesk`) via the `gh` CLI. External PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Default label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` at the repo root. See `docs/agents/domain.md`.
