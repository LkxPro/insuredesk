#!/usr/bin/env bash
# 测试环境更新:拉 :test 通道镜像并重启测试栈。与 prod 的 upgrade.sh 不同:
# 不解析 CalVer(可变 tag)、不做迁前备份(测试库可弃,见 docs/deployment.md)。
# --no-pull 供 make restart-test 用:改了 .env.test 时 recreate 即生效,无需拉镜像。
set -euo pipefail

PULL=1
if [ "${1:-}" = "--no-pull" ]; then
  PULL=0
fi

COMPOSE=(docker compose --env-file .env.test -f docker-compose.test.yml)
READY_URL="${READY_URL:-http://127.0.0.1:3001/healthz}"
WAIT_ATTEMPTS=30

cd "$(git rev-parse --show-toplevel)"

if [ ! -f .env.test ]; then
  echo "upgrade-test: 找不到 .env.test——首次部署见 docs/deployment.md" >&2
  exit 1
fi

if [ "$PULL" = "1" ]; then
  "${COMPOSE[@]}" pull insuredesk-api-test
fi
"${COMPOSE[@]}" up -d

for ((attempt = 1; attempt <= WAIT_ATTEMPTS; attempt++)); do
  if curl --fail --silent --max-time 3 "$READY_URL" >/dev/null; then
    echo "upgrade-test: 已就绪($("${COMPOSE[@]}" images insuredesk-api-test | tail -1 | awk '{print $2":"$3}'))"
    exit 0
  fi
  sleep 2
done

echo "upgrade-test: 超时未就绪,排查: docker logs insuredesk-api-test" >&2
"${COMPOSE[@]}" logs --tail 50 insuredesk-api-test >&2 || true
exit 1
