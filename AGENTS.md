# InsureDesk

## Development

Dev environment is **fully containerized** (ADR 0007). Host only needs Docker + git + editor.
First run:

```bash
docker compose up -d    # installs deps, starts db/api/web with hot reload
```

All services run in containers: dependency install (idempotent), PostgreSQL, api (port 3000), 
web (port 5173). Hot reload works for both api and web. Use `make` commands for common tasks:
`make test`, `make lint`, `make migrate`, `make shell`. Run `make` (no args) for help.

`docker compose down -v` drops volumes for clean state. Schema changes: `docker compose exec api pnpm db:migrate` 
generates + applies migration files (restarting the api service applies them too).
Full dev setup in `README.md`; production deploy in `docs/deployment.md`.

**In a git worktree** (`.worktrees/…`), always start the dev env with `scripts/dev-up.sh`
(or `make up`), never bare `docker compose up`. Bare compose binds the fixed default host
ports 3000/5173/5432, so parallel worktrees — and the main checkout — collide on them.
`dev-up.sh` writes a per-worktree `.env` with deterministic, non-overlapping ports derived
from the compose project name; the main checkout keeps the 3000/5173/5432 defaults.

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues (`LkxPro/insuredesk`) via the `gh` CLI. External PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Default label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
