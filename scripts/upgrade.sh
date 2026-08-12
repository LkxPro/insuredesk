#!/usr/bin/env bash
# Production upgrade. The running API image, not IMAGE_TAG alone, is the source
# of truth: IMAGE_TAG may already contain the target after an interrupted run.

resolve_latest_tag() {
  sed -n 's#.*refs/tags/v\([0-9]\{4\}\)\.\([0-9]\{2\}\)\.\([0-9]\{1,\}\)$#\1 \2 \3 v\1.\2.\3#p' \
    | sort -k1,1n -k2,2n -k3,3n \
    | tail -1 \
    | awk '{print $4}'
}

if [ -n "${UPGRADE_LIB:-}" ]; then
  return 0 2>/dev/null || exit 0
fi

set -euo pipefail
umask 077

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
COMPOSE=(docker compose -f "$COMPOSE_FILE")
ENV_FILE="${ENV_FILE:-.env}"
API_SERVICE="${API_SERVICE:-insuredesk-api-prod}"
READY_URL="${READY_URL:-http://127.0.0.1:3000/}"
WAIT_ATTEMPTS="${WAIT_ATTEMPTS:-60}"
WAIT_INTERVAL="${WAIT_INTERVAL:-2}"

read_configured_tag() {
  sed -n 's/^IMAGE_TAG=["'\'']\{0,1\}\([^"'\'']*\)["'\'']\{0,1\}$/\1/p' "$ENV_FILE"
}

resolve_target_image() {
  local tag="$1"
  IMAGE_TAG="$tag" "${COMPOSE[@]}" config --images "$API_SERVICE" \
    | awk -v suffix=":$tag" 'substr($0, length($0) - length(suffix) + 1) == suffix { print; exit }'
}

get_api_container_id() {
  "${COMPOSE[@]}" ps --all -q "$API_SERVICE" 2>/dev/null | head -1
}

get_running_image() {
  local container_id
  container_id="$(get_api_container_id)"
  if [ -n "$container_id" ]; then
    docker inspect --format '{{.Config.Image}}' "$container_id" 2>/dev/null || true
  fi
}

api_is_ready() {
  local target_image="$1" container_id actual_image running
  container_id="$(get_api_container_id)"
  [ -n "$container_id" ] || return 1
  actual_image="$(docker inspect --format '{{.Config.Image}}' "$container_id" 2>/dev/null || true)"
  running="$(docker inspect --format '{{.State.Running}}' "$container_id" 2>/dev/null || true)"
  [ "$actual_image" = "$target_image" ] && [ "$running" = true ] \
    && curl --fail --silent --show-error --max-time 3 "$READY_URL" >/dev/null
}

wait_for_api() {
  local target_image="$1" attempt
  for ((attempt = 1; attempt <= WAIT_ATTEMPTS; attempt++)); do
    if api_is_ready "$target_image"; then
      return 0
    fi
    sleep "$WAIT_INTERVAL"
  done
  return 1
}

write_configured_tag() {
  local tag="$1" tmp
  tmp="$(mktemp "${ENV_FILE}.upgrade.XXXXXX")"
  if ! sed "s/^IMAGE_TAG=.*/IMAGE_TAG=\"$tag\"/" "$ENV_FILE" >"$tmp"; then
    rm -f "$tmp"
    return 1
  fi
  chmod 600 "$tmp"
  mv "$tmp" "$ENV_FILE"
}

backup_before_upgrade() {
  local out container_path
  if ! out="$("${COMPOSE[@]}" run --rm -T backup once)"; then
    echo "upgrade: 迁前备份失败，中止升级（不改 tag）" >&2
    exit 1
  fi
  echo "$out"

  container_path="$(printf '%s\n' "$out" \
    | sed -n 's/^backup ok: \(\/backups\/[^ ]*\) .*/\1/p' | tail -1)"
  if [ -z "$container_path" ]; then
    echo "upgrade: 备份脚本未报告产出文件，中止" >&2
    exit 1
  fi

  if ! "${COMPOSE[@]}" run --rm -T --entrypoint sh backup -c "test -s '$container_path'"; then
    echo "upgrade: 备份产出为空或缺失（${container_path}），中止升级" >&2
    exit 1
  fi
  echo "upgrade: 迁前备份就绪 $container_path"
}

main() {
  cd "$(git rev-parse --show-toplevel)"

  if [ ! -f "$ENV_FILE" ]; then
    echo "upgrade: 找不到 ${ENV_FILE}——请在服务器部署目录运行" >&2
    exit 1
  fi

  local latest configured target_image running_image
  latest="$(git ls-remote --tags origin 'refs/tags/v*' | resolve_latest_tag)"
  if [ -z "$latest" ]; then
    echo "upgrade: 远端没有 CalVer tag，无可升级版本" >&2
    exit 1
  fi

  configured="$(read_configured_tag)"
  if [ -z "$configured" ]; then
    echo "upgrade: $ENV_FILE 里没有 IMAGE_TAG=——请先照 .env.example 补上" >&2
    exit 1
  fi

  target_image="$(resolve_target_image "$latest")"
  if [ -z "$target_image" ]; then
    echo "upgrade: 无法从 $COMPOSE_FILE 解析 $latest 的 API 镜像" >&2
    exit 1
  fi
  running_image="$(get_running_image)"
  echo "upgrade: 配置 ${configured}，运行 ${running_image:-未运行}，最新 ${latest}"

  if api_is_ready "$target_image"; then
    if [ "$configured" != "$latest" ]; then
      write_configured_tag "$latest"
      echo "upgrade: 已将 $ENV_FILE 同步为实际运行版本 $latest"
    fi
    echo "upgrade: 实际运行版本已是最新，无需升级"
    exit 0
  fi

  echo "upgrade: 拉取目标镜像 ${target_image}…"
  IMAGE_TAG="$latest" "${COMPOSE[@]}" pull "$API_SERVICE"

  echo "upgrade: 迁前备份…"
  backup_before_upgrade

  echo "upgrade: 拉起 ${latest}…"
  IMAGE_TAG="$latest" "${COMPOSE[@]}" up -d --no-deps "$API_SERVICE"
  if ! wait_for_api "$target_image"; then
    echo "upgrade: $latest 未在时限内就绪，$ENV_FILE 保持 ${configured}，可直接重试" >&2
    "${COMPOSE[@]}" logs --tail 120 "$API_SERVICE" >&2 || true
    exit 1
  fi

  write_configured_tag "$latest"
  echo "upgrade: 完成，已升级到 $latest"
}

main "$@"
