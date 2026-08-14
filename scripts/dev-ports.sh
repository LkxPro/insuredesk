#!/bin/sh
# stdout 只输出 export 行供 dev-up.sh eval，日志一律走 stderr。
set -eu

root=$(git rev-parse --show-toplevel)
cd "$root"

# 两者相同即主检出；linked worktree 的 git-dir 是 <主仓库>/.git/worktrees/<name>。
git_dir=$(git rev-parse --git-dir)
if [ "$git_dir" = "$(git rev-parse --git-common-dir)" ]; then
  echo "✓ 主检出，默认端口 db=5432 api=3000 web=5173" >&2
  exit 0
fi

# 内部名仓库内唯一、worktree move 后不变。
key=${git_dir##*/}
h=$(printf '%s' "$key" | cksum | cut -d' ' -f1)
h=$((h % 200))

# compose project 名只收小写字母/数字/-_。
project=$(printf '%s' "$key" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9_-' '-')

set_env() {
  _file=$1 _key=$2 _val=$3
  if grep -q "^${_key}=" "$_file"; then
    awk -v k="$_key" -v v="$_val" \
      'BEGIN{FS=OFS="="} $1==k{print k "=\"" v "\""; next} {print}' \
      "$_file" > "$_file.tmp" && mv "$_file.tmp" "$_file"
  else
    echo "${_key}=\"${_val}\"" >> "$_file"
  fi
}

env_file=.env
[ -f "$env_file" ] || printf '# 由 scripts/dev-ports.sh 为 worktree %s 生成，隔离并行 worktree 的宿主机端口。\n' \
  "$key" > "$env_file"

# 沿用既有 POSTGRES_PORT——否则 bump 过的 worktree 下次启动又跳回撞车的口。
current=$(sed -n 's/^POSTGRES_PORT=//p' "$env_file" | head -1 | tr -d '"')
case "$current" in
  ''|*[!0-9]*) offset=$h ;;
  *) offset=$((current - 15432)) ;;
esac
if [ "${1:-}" = "--bump" ]; then
  offset=$((offset + 1))
fi

db_port=$((15432 + offset))
api_port=$((13000 + offset))
web_port=$((15173 + offset))

set_env "$env_file" COMPOSE_PROJECT_NAME "$project"
set_env "$env_file" POSTGRES_PORT "$db_port"

if command -v lsof >/dev/null 2>&1; then
  while lsof -nP -iTCP:"$api_port" -sTCP:LISTEN >/dev/null 2>&1; do
    api_port=$((api_port + 1))
  done
fi

set_env apps/api/.env PORT "$api_port"
set_env apps/api/.env DATABASE_URL \
  "postgresql://insuredesk:insuredesk_dev@localhost:$db_port/insuredesk?schema=public"

echo "✓ worktree '$key' 端口：db=$db_port api=$api_port web=${web_port}（vite 撞车自增）" >&2

printf 'export DEV_PORTS_MODE=linked\n'
printf 'export VITE_API_URL=http://localhost:%s\n' "$api_port"
printf 'export VITE_PORT=%s\n' "$web_port"
