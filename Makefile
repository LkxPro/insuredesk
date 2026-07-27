.PHONY: help up down test lint migrate shell upgrade

help:
	@echo "InsureDesk development commands:"
	@echo "  make up       - Start all services"
	@echo "  make down     - Stop and remove containers"
	@echo "  make test     - Run tests in containers"
	@echo "  make lint     - Run linters"
	@echo "  make migrate  - Run database migrations"
	@echo "  make shell    - Open shell in api container"
	@echo "  make upgrade  - Upgrade production to the latest release"

up:
	./scripts/dev-up.sh --build

down:
	docker compose down -v

test:
	docker compose exec -T api pnpm test

lint:
	docker compose exec -T api pnpm lint

migrate:
	docker compose exec -T api pnpm db:migrate deploy

shell:
	docker compose exec api /bin/sh

# 一条命令升级生产到最新发版：解析最新 CalVer、迁前备份、钉版本、
# 拉起。跑在宿主机（需 git + docker + 服务器 .env），故不经容器。
upgrade:
	./scripts/upgrade.sh
