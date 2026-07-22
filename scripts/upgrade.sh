#!/usr/bin/env bash
# 生产升级（ADR 0009）：一条 `make upgrade` 干完，操作员只表达「升到最新」，
# 不手敲版本号。跑在宿主机（需 git + docker + 服务器 .env），不进容器。
#
# 顺序：解析最新 CalVer → 已是最新则直接退出（不备份、不重启）→ 迁前备份
# （复用 backup sidecar 的单次入口，不另写 dump 逻辑）→ 校验 dump 非空 → 写回
# .env 的具体 IMAGE_TAG（不是 latest）→ pull → up -d。备份是重启前第一步，迁移
# 随容器启动执行，故迁前备份天然早于迁移。
#
# make upgrade 是唯一 sanctioned 升级路径：手改 IMAGE_TAG 后直接 up 会让迁移
# 无备份执行，操作员自负（ADR 0009 已知风险）。

# 「最新」的排序口径必须与发版 workflow (.github/workflows/release.yml) 一致，
# 否则两处算出的「最新」会打架。stdin 收 `git ls-remote --tags` 的原始输出，
# stdout 吐最新 tag（无 CalVer 则空）。抽成函数供 upgrade.test.sh 直接测。
resolve_latest_tag() {
  # 年.月.序号三段各按数值比较，不按字典序：否则 v2026.07.10 会排在 v2026.07.9
  # 之前（release.yml 用 sort -n 规避的正是这点）。sed 只放行 CalVer tag，^{}
  # 解引用行与非 CalVer 的 ref 不匹配即被滤掉。
  sed -n 's#.*refs/tags/v\([0-9]\{4\}\)\.\([0-9]\{2\}\)\.\([0-9]\{1,\}\)$#\1 \2 \3 v\1.\2.\3#p' \
    | sort -k1,1n -k2,2n -k3,3n \
    | tail -1 \
    | awk '{print $4}'
}

# 被 test 以 `UPGRADE_LIB=1 . upgrade.sh` 载入时只暴露函数、不跑 main，也不执行
# 下方 `set -o pipefail`（测试用 POSIX sh 载入，dash 不认 pipefail）。
if [ -n "${UPGRADE_LIB:-}" ]; then
  # shellcheck disable=SC2317  # 直接执行本脚本时 UPGRADE_LIB 未设，走不到这里
  return 0 2>/dev/null || exit 0
fi

set -euo pipefail

COMPOSE="docker compose -f docker-compose.prod.yml"
ENV_FILE="${ENV_FILE:-.env}"

main() {
  cd "$(git rev-parse --show-toplevel)"

  if [ ! -f "$ENV_FILE" ]; then
    echo "upgrade: 找不到 ${ENV_FILE}——请在服务器部署目录运行" >&2
    exit 1
  fi

  local latest current
  latest="$(git ls-remote --tags origin 'refs/tags/v*' | resolve_latest_tag)"
  if [ -z "$latest" ]; then
    echo "upgrade: 远端没有 CalVer tag，无可升级版本" >&2
    exit 1
  fi

  current="$(sed -n 's/^IMAGE_TAG=["'\'']\{0,1\}\([^"'\'']*\)["'\'']\{0,1\}$/\1/p' "$ENV_FILE")"
  if [ -z "$current" ]; then
    echo "upgrade: $ENV_FILE 里没有 IMAGE_TAG=——请先照 .env.example 补上" >&2
    exit 1
  fi
  echo "upgrade: 当前 ${current}，最新 ${latest}"

  if [ "$current" = "$latest" ]; then
    echo "upgrade: 已是最新，无需升级"
    exit 0
  fi

  echo "upgrade: 迁前备份…"
  backup_before_upgrade

  echo "upgrade: 钉版本 $latest 并拉起…"
  # 写回具体 tag（非 latest）：回滚有明确目标、stray up -d 不跳版本（ADR 0009）。
  # BSD/GNU sed 的 -i 参数不同，用临时文件改写规避。
  sed "s/^IMAGE_TAG=.*/IMAGE_TAG=\"$latest\"/" "$ENV_FILE" >"$ENV_FILE.tmp"
  mv "$ENV_FILE.tmp" "$ENV_FILE"

  $COMPOSE pull insuredesk-api-prod
  $COMPOSE up -d

  echo "upgrade: 完成，已升级到 $latest"
}

# 迁前备份复用 backup sidecar 的单次入口，不另写 dump 逻辑。`run --rm backup once`
# 打印 `backup ok: /backups/insuredesk-<ts>.sql.gz (<size>)`；取出容器内路径，再经
# 同一 backup 服务断言该文件非空——空则中止升级，不改 tag、不 pull（残缺备份护不住
# 即将执行的迁移）。容器内落盘路径恒为 /backups：宿主机 BACKUP_DIR 只改 bind mount
# 的宿主机侧、不进 backup 容器环境，故 pg_dump 始终写 /backups，路径可硬编码。
# 用第二次 compose run 复查而非拼宿主机路径，免去重算 ${BACKUP_DIR:-${HOME}/…} 默认值。
backup_before_upgrade() {
  local out container_path
  if ! out="$($COMPOSE run --rm -T backup once)"; then
    echo "upgrade: 迁前备份失败，中止升级（不改 tag、不 pull）" >&2
    exit 1
  fi
  echo "$out"

  container_path="$(printf '%s\n' "$out" \
    | sed -n 's/^backup ok: \(\/backups\/[^ ]*\) .*/\1/p' | tail -1)"
  if [ -z "$container_path" ]; then
    echo "upgrade: 备份脚本未报告产出文件，中止" >&2
    exit 1
  fi

  if ! $COMPOSE run --rm -T --entrypoint sh backup -c "test -s '$container_path'"; then
    echo "upgrade: 备份产出为空或缺失（${container_path}），中止升级" >&2
    exit 1
  fi
  echo "upgrade: 迁前备份就绪 $container_path"
}

main "$@"
