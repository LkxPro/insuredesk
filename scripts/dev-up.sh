#!/usr/bin/env bash
# 启动开发环境：校验 node/pnpm → 按需安装依赖 → 起 db → 前台并行 api+web。
# api 和 web 跑在宿主机，只有 Postgres 在容器里。
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"

# --- Node 版本 ---------------------------------------------------------------
# 不符时报错而非静默用错版本跑：node_modules 里的原生二进制（esbuild、prisma
# engines）按安装时的 ABI 编译，换版本跑会以难懂的方式炸。
required_node="$(tr -d '[:space:]' < .nvmrc)"
current_node="$(node --version | tr -d 'v')"
if [ "$current_node" != "$required_node" ]; then
  echo "✗ Node 版本不符：需要 $required_node（.nvmrc），当前 $current_node"
  echo "  运行 'nvm use'；未安装则先 'nvm install'。"
  exit 1
fi

if ! command -v pnpm > /dev/null 2>&1; then
  echo "✗ 找不到 pnpm。运行一次 'corepack enable' 即可（版本由 packageManager 字段钉定）。"
  exit 1
fi

echo "✓ node $current_node · pnpm $(pnpm --version)"

# --- 依赖 -------------------------------------------------------------------
# 让 make dev 幂等且秒开。
if [ ! -d node_modules ] || [ "pnpm-lock.yaml" -nt "node_modules" ]; then
  echo "→ pnpm install"
  pnpm install --frozen-lockfile
  # pnpm 只在顶层条目增删时才改 node_modules 的 mtime，纯传递依赖的升级不会——
  # 少了这一下，那种 lockfile 会永远比它新，每次都白装一遍。
  touch node_modules
fi

# --- 端口 -------------------------------------------------------------------
# 并行 worktree 各自跑一套 db/api/web。db 端口经 compose .env 传给
# docker-compose.yml，api 端口写进 apps/api/.env（Zod 在启动时校验它），
# web 由 vite 从 5173 起自动递增、并通过 VITE_API_URL 反代到本 worktree 的 api。
# 主仓库不写 compose .env，沿用 5432/3000/5173。
api_env="apps/api/.env"
if [ ! -f "$api_env" ]; then
  cp apps/api/.env.example "$api_env"
  echo "✓ 已从 .env.example 生成 $api_env"
fi

# sed -i 的参数在 BSD/GNU 下不兼容，故用临时文件绕开。
set_env() {
  local file="$1" key="$2" value="$3"
  if grep -q "^${key}=" "$file"; then
    awk -v k="$key" -v v="$value" \
      'BEGIN{FS=OFS="="} $1==k{print k "=\"" v "\""; next} {print}' \
      "$file" > "$file.tmp" && mv "$file.tmp" "$file"
  else
    echo "${key}=\"${value}\"" >> "$file"
  fi
}

case "$root" in
  */.worktrees/*)
    project="${COMPOSE_PROJECT_NAME:-$(basename "$root")}"
    # cksum 只取决于输入字节，跨机器跨时间恒定——同一 worktree 每次拿到同一组
    # 端口。mod 200 让 db 落在 15432+、api 落在 13000+，两段互不重叠。
    h=$(printf '%s' "$project" | cksum | cut -d' ' -f1)
    h=$((h % 200))

    db_port=$((15432 + h))
    api_port=$((13000 + h))

    # 两个 worktree 落到同一个 h 时，换 COMPOSE_PROJECT_NAME 重算一组；手改这些
    # 端口不成立——每次都按 hash 重写，DATABASE_URL 才不会跟 db 端口走散。
    [ -f .env ] || printf '# 由 scripts/dev-up.sh 为 worktree 工程 %s 生成，隔离并行 worktree 的宿主机端口。\n' \
      "$project" > .env
    set_env .env POSTGRES_PORT "$db_port"

    set_env "$api_env" PORT "$api_port"
    set_env "$api_env" DATABASE_URL \
      "postgresql://insuredesk:insuredesk_dev@localhost:$db_port/insuredesk?schema=public"
    export VITE_API_URL="http://localhost:$api_port"

    echo "✓ worktree '$project' 端口：db=$db_port api=$api_port web=5173+"
    ;;
esac

# --- 数据库 -----------------------------------------------------------------
# --wait 阻塞到 healthcheck 通过，api 启动时库已就绪（dev-init.ts 另有重试兜底
# 覆盖首次 initdb）。--remove-orphans 清掉本工程下占着 3000/5173 的容器，否则
# 宿主机上的 api 撞 EADDRINUSE。
echo "→ docker compose up -d --wait --remove-orphans db"
docker compose up -d --wait --remove-orphans db

# --- 服务 -------------------------------------------------------------------
# 迁移 + seed 由 api 侧的 dev-init 负责，不在本脚本里。
echo "→ pnpm dev（Ctrl-C 停止；db 容器保持运行，make down 停它）"
exec pnpm dev
