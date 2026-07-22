.PHONY: help up down test lint migrate shell

help:
	@echo "InsureDesk development commands:"
	@echo "  make up       - Start all services"
	@echo "  make down     - Stop and remove containers"
	@echo "  make test     - Run tests in containers"
	@echo "  make lint     - Run linters"
	@echo "  make migrate  - Run database migrations"
	@echo "  make shell    - Open shell in api container"

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
