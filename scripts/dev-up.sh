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
api_url="${VITE_API_URL:-http://localhost:3000}"
api_port="${api_url##*:}"
web_port="${VITE_PORT:-5173}"

listening() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

# 已退出未 wait 的 pnpm 是僵尸，kill -0 依然成功，必须靠 stat 甄别。
dev_alive() {
  kill -0 "$dev_pid" 2>/dev/null || return 1
  ! ps -o stat= -p "$dev_pid" 2>/dev/null | grep -q Z
}

stop_family() {
  kill "$dev_pid" 2>/dev/null || true
  wait "$dev_pid" 2>/dev/null || true
  # 兜底：pnpm 没把信号传下去时，按口清残留。
  for p in "$web_port" "$api_port"; do
    if listening "$p"; then
      lsof -tiTCP:"$p" -sTCP:LISTEN | xargs kill 2>/dev/null || true
    fi
  done
}

interrupted() {
  rc=$1
  trap - INT TERM
  stop_family
  exit "$rc"
}

# 就绪探针只认 LISTEN，上轮 dev 的残留会被误当成就绪（strictPort 的新 vite
# 随后撞 EADDRINUSE）。开跑前清场：只杀命令行或 cwd 落在本仓库的占用者，
# 外来进程报错交给用户。
foreign=0
for p in "$web_port" "$api_port"; do
  for pid in $(lsof -tiTCP:"$p" -sTCP:LISTEN 2>/dev/null); do
    cmd="$(ps -o command= -p "$pid" 2>/dev/null || true)"
    cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"
    [ -n "$cmd$cwd" ] || continue
    case "$cmd$cwd" in
      *"$root"*)
        echo "→ 清掉上轮 dev 残留：${cmd}（pid ${pid}，端口 ${p}）"
        kill "$pid" 2>/dev/null || true
        ;;
      *)
        echo "✗ 端口 ${p} 被本仓库外的进程占用：${cmd}（pid ${pid}），先停掉它" >&2
        foreign=1
        ;;
    esac
  done
done
[ "$foreign" -eq 0 ] || exit 1

deadline=$((SECONDS + 10))
while listening "$web_port" || listening "$api_port"; do
  if [ "$SECONDS" -ge "$deadline" ]; then
    for p in "$web_port" "$api_port"; do
      lsof -tiTCP:"$p" -sTCP:LISTEN 2>/dev/null | xargs kill -9 2>/dev/null || true
    done
    break
  fi
  sleep 1
done

echo "→ pnpm dev（Ctrl-C 停止；db 容器保持运行，make down 停它）"
pnpm dev &
dev_pid=$!
trap 'interrupted 130' INT
trap 'interrupted 143' TERM

deadline=$((SECONDS + 60))
while :; do
  if ! dev_alive; then
    rc=0
    wait "$dev_pid" || rc=$?
    echo "✗ pnpm dev 未就绪即退出（码 ${rc}），日志见上" >&2
    exit "$rc"
  fi
  if listening "$web_port" && listening "$api_port"; then
    break
  fi
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "✗ 60s 内 web($web_port)/api($api_port) 未就绪，日志见上" >&2
    trap - INT TERM
    stop_family
    exit 1
  fi
  sleep 1
done

git_dir="$(git rev-parse --git-dir)"
if [ "$git_dir" = "$(git rev-parse --git-common-dir)" ]; then
  where="主检出"
else
  where="worktree '${git_dir##*/}'"
fi
branch="$(git branch --show-current)"
[ -n "$branch" ] || branch="$(git rev-parse --short HEAD)"

printf '──────────────────────────────────────────\n'
printf '✓ %s · %s\n' "$where" "$branch"
printf '  http://127.0.0.1:%s/\n' "$web_port"
printf '  再开：make open\n'
printf '──────────────────────────────────────────\n'

rc=0
wait "$dev_pid" || rc=$?
exit "$rc"
