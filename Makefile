.PHONY: help dev down db-reset test typecheck lint check upgrade

help:
	@echo "InsureDesk development commands:"
	@echo "  make dev       - Start development environment (idempotent one-command)"
	@echo "  make down      - Stop database container"
	@echo "  make db-reset  - Reset database (drop volume and recreate)"
	@echo "  make test      - Run tests on host"
	@echo "  make typecheck - Run type checking on host"
	@echo "  make lint      - Run linters on host"
	@echo "  make check     - Run full CI check suite (pre-push validation)"
	@echo "  make upgrade   - Upgrade production to the latest release"

dev:
	@./scripts/dev-up.sh

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

# 一条命令升级生产到最新发版：解析最新 CalVer、迁前备份、钉版本、
# 拉起。跑在宿主机（需 git + docker + 服务器 .env），故不经容器。
upgrade:
	./scripts/upgrade.sh
