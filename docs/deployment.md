# Deployment

InsureDesk uses two Docker Compose files, one per scenario (ADR 0007):

- **`docker-compose.yml`** — development. Containerizes only PostgreSQL; the app
  (`apps/api` + `apps/web`) runs on the host via `pnpm dev` with hot reload.
- **`docker-compose.prod.yml`** — single-machine production. Two containers:
  PostgreSQL + the API, where the API also serves the built web SPA. Sits behind
  the host's existing nginx.

Migrations are **always run manually**, in both environments.

---

## Development

Only Postgres runs in a container. The app runs on the host.

```bash
docker compose up -d    # start PostgreSQL (named volume, port 5432 exposed)
pnpm db:migrate         # apply migrations (first run, and after schema changes)
pnpm db:seed            # create demo users, SLA policies, and demo tickets
pnpm dev                # start api + web with hot reload
```

- The API reads `apps/api/.env` (copy from `apps/api/.env.example`). Its
  `DATABASE_URL` points at `localhost:5432`.
- Port `5432` is published so GUI tools (Prisma Studio, DataGrip, DBeaver) can
  connect directly.
- Reset to a clean database at any time:

  ```bash
  docker compose down -v   # -v drops the data volume
  docker compose up -d
  pnpm db:migrate
  pnpm db:seed
  ```

The API does **not** serve the frontend in development — Vite owns the dev
server, and static serving is disabled unless `NODE_ENV=production`.

---

## Production

One-time server setup, then a repeatable deploy loop.

### 1. Prerequisites

- Docker + Docker Compose on the server.
- The host's nginx (already present) will reverse-proxy public traffic to the
  API on `127.0.0.1:3000`.

### 2. Create the server-side `.env`

Copy `.env.example` to `.env` on the server and fill in real values. This file
is **not committed** and is read by `docker-compose.prod.yml` via `env_file`.

```bash
cp .env.example .env
# edit .env: set POSTGRES_PASSWORD, SESSION_SECRET (openssl rand -hex 32),
# ADMIN_INITIAL_PASSWORD (for step 5), etc.
```

Key points:

- `DATABASE_URL` host is the compose **service name `db`**, not `localhost`.
- The `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` values must match the
  credentials embedded in `DATABASE_URL`.
- `NODE_ENV=production` — required for SPA static serving and secure cookies.

### 3. Build and start

```bash
# Build the API image (multi-stage: installs, prisma generate, web build) and
# start both services. Postgres comes up first (healthcheck-gated).
docker compose -f docker-compose.prod.yml up -d --build
```

> **Building behind a restricted network (e.g. mainland China).** The default
> build pulls from `registry.npmjs.org` and `binaries.prisma.sh`, both of which
> are slow/unreachable on some networks. Point the build at mirrors via
> build-args (defaults are the official sources, so CI is unaffected):
>
> ```bash
> docker build \
>   --build-arg NPM_REGISTRY=https://registry.npmmirror.com \
>   --build-arg PRISMA_ENGINES_MIRROR=https://registry.npmmirror.com/-/binary/prisma \
>   -f apps/api/Dockerfile -t insuredesk-api:latest .
> ```
>
> With Compose, set `NPM_REGISTRY` / `PRISMA_ENGINES_MIRROR` in the server-side
> `.env` (Compose interpolates them into the `api` service `build.args`), then
> `docker compose -f docker-compose.prod.yml up -d --build` as usual. Also
> pre-pull the base image (`docker pull node:22-alpine`) if Docker Hub is flaky.

### 4. Run migrations (manual, pre-deploy)

Migrations are decoupled from app startup so a failed migration never takes down
a running service. Run them against the DB before (or right after) bringing the
API up:

```bash
docker compose -f docker-compose.prod.yml run --rm api pnpm db:deploy
```

`db:deploy` runs `prisma migrate deploy` — it applies committed migrations only,
never generates new ones.

### 5. Bootstrap system data (first install only)

A freshly migrated database has no users, roles, or SLA policies — and creating
users requires a logged-in admin, so the system cannot bootstrap itself through
the UI. Set `ADMIN_INITIAL_PASSWORD` (and optionally `ADMIN_USERNAME`, default
`admin`) in the server-side `.env`, then:

```bash
docker compose -f docker-compose.prod.yml run --rm api pnpm db:bootstrap
```

This creates the 4 preset roles, the 4 default SLA policies, and one admin
account. It is idempotent: re-running upserts roles/policies but **never
touches an existing user** — a rotated admin password survives re-runs. You can
remove `ADMIN_INITIAL_PASSWORD` from `.env` once bootstrap has completed; the
password itself is changeable later in 用户管理.

Do **not** run `db:seed` in production — it creates demo accounts with the
publicly documented password `password123` plus demo tickets.

### 6. Redeploying a new version

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build   # rebuild + restart
docker compose -f docker-compose.prod.yml run --rm api pnpm db:deploy  # if schema changed
```

### Ports and exposure

- The API binds to **`127.0.0.1:3000` only** — never `0.0.0.0`. It is not
  directly reachable from the public network; nginx is the only front door.
- Postgres publishes **no host port** in production; only the API container
  reaches it over the compose network.

---

## Host nginx reverse-proxy example

nginx terminates HTTPS and proxies everything to the API on loopback. The API
serves both `/trpc/*` and the SPA, so a single upstream covers the whole app.

```nginx
server {
    listen 443 ssl;
    server_name insuredesk.example.com;

    ssl_certificate     /etc/letsencrypt/live/insuredesk.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/insuredesk.example.com/privkey.pem;

    # Everything — SPA assets, index.html fallback, and /trpc — goes to the API.
    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}

# Redirect plain HTTP to HTTPS.
server {
    listen 80;
    server_name insuredesk.example.com;
    return 301 https://$host$request_uri;
}
```

---

## Migration command reference

| Command | When | What it does |
| --- | --- | --- |
| `pnpm db:migrate` | Development | `prisma migrate dev` — creates + applies migrations from schema changes |
| `pnpm db:seed` | Development **only** | Creates/refreshes demo users (weak shared password), SLA policies, and demo tickets |
| `pnpm db:deploy` | Production | `prisma migrate deploy` — applies committed migrations only |
| `docker compose -f docker-compose.prod.yml run --rm api pnpm db:deploy` | Production (containerized) | Runs `db:deploy` inside a one-off API container against `db` |
| `docker compose -f docker-compose.prod.yml run --rm api pnpm db:bootstrap` | Production, first install | Preset roles + default SLA policies + initial admin (from `ADMIN_INITIAL_PASSWORD`); idempotent, never touches existing users |
