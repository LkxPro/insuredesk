.PHONY: help dev open down db-reset test typecheck lint check upgrade agent-loop-queue agent-loop-dispatch agent-loop-daemon agent-loop-daemon-start agent-loop-status

help:
	@echo "InsureDesk development commands:"
	@echo "  make dev       - Start development environment (idempotent one-command)"
	@echo "  make open      - Open the running dev site in the browser"
	@echo "  make down      - Stop database container"
	@echo "  make db-reset  - Reset database (drop volume and recreate)"
	@echo "  make test      - Run tests on host"
	@echo "  make typecheck - Run type checking on host"
	@echo "  make lint      - Run linters on host"
	@echo "  make check     - Run full CI check suite (pre-push validation)"
	@echo "  make agent-loop-queue    - Preview dependency-free agent tickets"
	@echo "  make agent-loop-dispatch - Start workers for dependency-free tickets"
	@echo "  make agent-loop-daemon   - Continuously dispatch dependency-free tickets"
	@echo "  make agent-loop-daemon-start - Start the daemon detached (survives session exit)"
	@echo "  make agent-loop-status   - Watch live worker status (phase, last event, stalls)"
	@echo "  make upgrade   - Upgrade production to the latest release"

dev:
	@./scripts/dev-up.sh

open:
	@./scripts/dev-open.sh

down:
	@docker compose down --remove-orphans

db-reset:
	@docker compose down -v --remove-orphans
	@echo "Database volume removed. Run 'make dev' to recreate and seed."

test:
	@pnpm test

typecheck:
	@pnpm typecheck

lint:
	@pnpm lint

check:
	@sh scripts/ci.sh

agent-loop-queue:
	@node scripts/agent/main.ts queue

agent-loop-dispatch:
	@node scripts/agent/main.ts dispatch

agent-loop-status:
	@node scripts/agent/main.ts status --watch

# caffeinate 防合盖/空闲睡眠打断 heartbeat 导致 worker 被误判 stale 杀掉。
agent-loop-daemon:
	@if command -v caffeinate >/dev/null 2>&1; then \
	  exec caffeinate -dims node scripts/agent/main.ts daemon; \
	fi; \
	exec node scripts/agent/main.ts daemon

agent-loop-daemon-start:
	@node scripts/agent/main.ts daemon --detach

# 一条命令升级生产到最新发版：解析最新 CalVer、迁前备份、钉版本、
# 拉起。跑在宿主机（需 git + docker + 服务器 .env），故不经容器。
upgrade:
	./scripts/upgrade.sh
