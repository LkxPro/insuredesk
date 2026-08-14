#!/usr/bin/env bash
# api 和 web 跑在宿主机，只有 Postgres 在容器里。
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"

# --- Node --------------------------------------------------------------------
. scripts/ensure-node.sh

# --- 依赖 -------------------------------------------------------------------
if [ ! -d node_modules ] || [ "pnpm-lock.yaml" -nt "node_modules" ]; then
  echo "→ pnpm install"
  pnpm install --frozen-lockfile
  # pnpm 只在顶层条目增删时才改 node_modules 的 mtime，纯传递依赖的升级不会——
  # 少了这一下，那种 lockfile 会永远比它新，每次都白装一遍。
  touch node_modules
fi

# --- 端口 -------------------------------------------------------------------
# eval 把 dev-ports.sh 的 VITE_API_URL/VITE_PORT 带进本进程；少了
# VITE_API_URL，web 会静默代理到主仓库的 :3000。
api_env="apps/api/.env"
if [ ! -f "$api_env" ]; then
  cp apps/api/.env.example "$api_env"
  echo "✓ 已从 .env.example 生成 $api_env"
fi

eval "$(sh scripts/dev-ports.sh)"

# --- Docker ------------------------------------------------------------------
. scripts/ensure-docker.sh

# --- 数据库 -----------------------------------------------------------------
# --wait 阻塞到 healthcheck 通过，api 启动时库已就绪（dev-init.ts 另有重试兜底
# 覆盖首次 initdb）。--remove-orphans 清掉本工程下占着 3000/5173 的容器，否则
# 宿主机上的 api 撞 EADDRINUSE。
echo "→ docker compose up -d --wait --remove-orphans db"
attempt=0
while :; do
  if out=$(docker compose up -d --wait --remove-orphans db 2>&1); then
    [ -z "$out" ] || printf '%s\n' "$out"
    break
  fi
  printf '%s\n' "$out" >&2
  case "$out" in
    *"port is already allocated"*|*"address already in use"*) ;;
    *) exit 1 ;;
  esac
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 5 ] || [ "${DEV_PORTS_MODE:-main}" != "linked" ]; then
    echo "✗ db 端口被占且无法自愈，放弃" >&2
    exit 1
  fi
  echo "→ db 端口被占，offset+1 重试（第 $attempt 次）"
  eval "$(sh scripts/dev-ports.sh --bump)"
done

# --- 服务 -------------------------------------------------------------------
# 迁移 + seed 由 api 侧的 dev-init 负责，不在本脚本里。
echo "→ pnpm dev（Ctrl-C 停止；db 容器保持运行，make down 停它）"
exec pnpm dev
