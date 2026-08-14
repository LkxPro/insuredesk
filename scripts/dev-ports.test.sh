#!/bin/sh
# 夹具用真 git 仓库：检测逻辑建立在 rev-parse 的输出形态上，stub 掉等于没测。
set -eu

repo_root=$(cd "$(dirname "$0")/.." && pwd)
script="$repo_root/scripts/dev-ports.sh"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

fail() { echo "✗ $1" >&2; exit 1; }
ok() { echo "✓ $1"; }

# 第二个 worktree 与第一个同 basename，验 git 内部名去重。
git init -q "$tmp/main"
mkdir -p "$tmp/main/apps/api"
printf 'DATABASE_URL="postgresql://x@localhost:5432/x"\nPORT="3000"\n' \
  > "$tmp/main/apps/api/.env.example"
git -C "$tmp/main" add -A
git -C "$tmp/main" -c user.email=t@t -c user.name=t commit -qm init

git -C "$tmp/main" worktree add -q "$tmp/wt" -b wt1
mkdir -p "$tmp/nested"
git -C "$tmp/main" worktree add -q "$tmp/nested/wt" -b wt2

# worktree 不带未跟踪文件，这里顶替 dev-up.sh 的 .env 复制。
seed_api_env() { cp "$1/apps/api/.env.example" "$1/apps/api/.env"; }

h_of() { printf '%s' "$1" | cksum | cut -d' ' -f1; }

mkdir "$tmp/bin"
cat > "$tmp/bin/lsof" <<'EOF'
#!/bin/sh
for a in "$@"; do
  case "$a" in
    -iTCP:*)
      p=${a#-iTCP:}
      for o in ${OCCUPIED_PORTS:-}; do [ "$p" = "$o" ] && exit 0; done
      ;;
  esac
done
exit 1
EOF
chmod +x "$tmp/bin/lsof"
export PATH="$tmp/bin:$PATH"

out=$(cd "$tmp/main" && sh "$script" 2>/dev/null)
[ -z "$out" ] || fail "主检出不应输出 export 行，得到：$out"
[ ! -f "$tmp/main/.env" ] || fail "主检出不应生成 compose .env"
[ ! -f "$tmp/main/apps/api/.env" ] || fail "主检出不应生成 api .env"
ok "主检出保持默认端口、不落盘"

seed_api_env "$tmp/wt"
out=$(cd "$tmp/wt" && sh "$script" 2>/dev/null)
key=$(basename "$(git -C "$tmp/wt" rev-parse --git-dir)")
[ "$key" = "wt" ] || fail "内部 worktree 名应为 wt，得到 $key"
h=$(( $(h_of "$key") % 200 ))
grep -q "POSTGRES_PORT=\"$((15432 + h))\"" "$tmp/wt/.env" \
  || fail "compose .env 未写入 hash db 端口"
grep -q "COMPOSE_PROJECT_NAME=\"wt\"" "$tmp/wt/.env" \
  || fail "compose .env 未写入消毒后的 project 名"
grep -q "PORT=\"$((13000 + h))\"" "$tmp/wt/apps/api/.env" \
  || fail "api .env 未写入 hash api 端口"
grep -q "localhost:$((15432 + h))" "$tmp/wt/apps/api/.env" \
  || fail "DATABASE_URL 未跟随 db 端口"
echo "$out" | grep -q "VITE_API_URL=http://localhost:$((13000 + h))" \
  || fail "stdout 缺 VITE_API_URL export"
echo "$out" | grep -q "VITE_PORT=$((15173 + h))" \
  || fail "stdout 缺 VITE_PORT export"
echo "$out" | grep -q "DEV_PORTS_MODE=linked" || fail "stdout 缺 DEV_PORTS_MODE"
ok "linked worktree 首次按 hash 落盘并导出（offset=${h}）"

sed 's/^POSTGRES_PORT=.*/POSTGRES_PORT="15499"/' "$tmp/wt/.env" > "$tmp/wt/.env.tmp" \
  && mv "$tmp/wt/.env.tmp" "$tmp/wt/.env"
out=$(cd "$tmp/wt" && sh "$script" 2>/dev/null)
grep -q 'POSTGRES_PORT="15499"' "$tmp/wt/.env" || fail "粘性端口被重算"
grep -q "localhost:15499" "$tmp/wt/apps/api/.env" || fail "DATABASE_URL 未跟随粘性端口"
echo "$out" | grep -q "VITE_PORT=$((15173 + 67))" || fail "web 端口未跟随粘性 offset"
ok "粘性端口重跑保持不变（15499, offset=67）"

out=$(cd "$tmp/wt" && sh "$script" --bump 2>/dev/null)
grep -q 'POSTGRES_PORT="15500"' "$tmp/wt/.env" || fail "--bump 未递增 db 端口"
echo "$out" | grep -q "VITE_PORT=$((15173 + 68))" || fail "--bump 未递增 web 端口"
out=$(cd "$tmp/wt" && sh "$script" 2>/dev/null)
grep -q 'POSTGRES_PORT="15500"' "$tmp/wt/.env" || fail "bump 后的端口未粘住"
ok "--bump 递增一次并粘住（15500）"

occupied=$((13000 + 68))
out=$(cd "$tmp/wt" && OCCUPIED_PORTS="$occupied" sh "$script" 2>/dev/null)
grep -q "PORT=\"$((occupied + 1))\"" "$tmp/wt/apps/api/.env" \
  || fail "api 端口被占时未 +1 探测"
grep -q 'POSTGRES_PORT="15500"' "$tmp/wt/.env" || fail "api 探测不应影响 db 端口"
echo "$out" | grep -q "VITE_API_URL=http://localhost:$((occupied + 1))" \
  || fail "VITE_API_URL 未跟随探测后的 api 端口"
ok "api 端口被占 +1 探测（$occupied → $((occupied + 1))）"

seed_api_env "$tmp/nested/wt"
(cd "$tmp/nested/wt" && sh "$script" 2>/dev/null >/dev/null)
key2=$(basename "$(git -C "$tmp/nested/wt" rev-parse --git-dir)")
[ "$key2" != "wt" ] || fail "git 未对同 basename worktree 去重"
p1=$(sed -n 's/^POSTGRES_PORT=//p' "$tmp/wt/.env" | tr -d '"')
p2=$(sed -n 's/^POSTGRES_PORT=//p' "$tmp/nested/wt/.env" | tr -d '"')
[ "$p1" != "$p2" ] || fail "同 basename 两 worktree 端口撞车（$p1）"
ok "同 basename worktree 经 git 内部名去重（wt vs ${key2}，${p1} vs ${p2}）"

git -C "$tmp/main" worktree add -q "$tmp/Weird.Name" -b wt3 2>/dev/null
seed_api_env "$tmp/Weird.Name"
(cd "$tmp/Weird.Name" && sh "$script" 2>/dev/null >/dev/null)
pname=$(sed -n 's/^COMPOSE_PROJECT_NAME=//p' "$tmp/Weird.Name/.env" | tr -d '"')
case "$pname" in
  *[!a-z0-9_-]*|"") fail "project 名未消毒：$pname" ;;
esac
ok "project 名消毒（${pname}）"

echo "全部通过"
