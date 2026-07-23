#!/usr/bin/env bash
# 启动开发环境。并行 git worktree 下各自的 compose 工程共用同一份 docker-compose.yml，
# 而其中的宿主机端口默认值是固定的 3000/5173/5432——多个 worktree 同时 `up` 会互相抢占，
# 也会挤掉主仓库的 dev 容器。本脚本只在 worktree（路径含 /.worktrees/）里按工程名的稳定
# 哈希生成一份 .env，把三个宿主机端口错开；主仓库不写 .env，沿用默认端口。
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"

# 主仓库不落 .env：沿用 docker-compose.yml 里的 3000/5173/5432 默认值。
case "$root" in
  */.worktrees/*)
    env_file="$root/.env"
    if [ -f "$env_file" ]; then
      echo "dev-up: $env_file 已存在，沿用其中端口。"
    else
      project="${COMPOSE_PROJECT_NAME:-$(basename "$root")}"
      # cksum 的校验和只取决于输入字节，跨机器、跨时间恒定 —— 同一 worktree 每次
      # 得到同一组端口（幂等）。mod 200 把端口压进三段互不重叠的百位区间。
      h=$(printf '%s' "$project" | cksum | cut -d' ' -f1)
      h=$((h % 200))
      {
        echo "# 由 scripts/dev-up.sh 为 worktree 工程 '$project' 生成，隔离并行 worktree 的宿主机端口。"
        echo "# 删除本文件即可在下次 dev-up 时重新分配。"
        echo "POSTGRES_PORT=$((15432 + h))"
        echo "API_PORT=$((13000 + h))"
        echo "WEB_PORT=$((15173 + h))"
      } > "$env_file"
      echo "dev-up: 已为工程 '$project' 生成 $env_file"
      echo "        POSTGRES_PORT=$((15432 + h))  API_PORT=$((13000 + h))  WEB_PORT=$((15173 + h))"
    fi
    ;;
esac

exec docker compose up -d "$@"
