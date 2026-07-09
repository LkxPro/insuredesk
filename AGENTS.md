# InsureDesk

## Development

Dev containerizes **only PostgreSQL**; the app runs on the host with hot reload
(ADR 0007). First run, and whenever you return to a fresh session:

```bash
docker compose up -d    # start PostgreSQL (the #1 "forgot to start the DB" gotcha)
pnpm db:migrate         # apply migrations (first run / after schema changes)
pnpm dev                # start api + web
```

`docker compose down -v` drops the data volume for a clean database. Full dev
setup, production deploy steps, migration commands, and the host nginx
reverse-proxy config are in `docs/deployment.md`.

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues (`LkxPro/insuredesk`) via the `gh` CLI. External PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Default label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
