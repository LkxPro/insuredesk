#!/bin/sh
# 生产数据库备份。跑在 backup sidecar 容器内（postgres:17-alpine，
# 与 db 同镜像 → pg_dump 版本与服务器 Postgres 精确匹配），经 compose 网络
# pg_dump，gzip 落宿主机 bind mount（挂进容器的 /backups），保留 14 天。
#
# 三个入口：
#   once   跑一次备份即退出——sidecar 启动自证、升级前手动备份、
#          手动 `docker compose run --rm backup once` 共用这一份逻辑。
#   serve  先备份一次，再交给内置 crond 每晚 21:30（sidecar 的常驻命令）。
#   check  compose healthcheck 调用：断言备份目录里有 25h 内的新文件。
#
# 仅本机备份、无异地副本，且 healthcheck 只验「文件在且新鲜」不验「能灌回」，
# 均为主动接受的已知风险；恢复步骤见 docs/deployment.md。
set -eu
# pg_dump 的失败必须穿过 gzip 传出，否则截断的转储会被当成完整备份改名。
# 仅在 sidecar 的 busybox ash 里跑，pipefail 受支持；POSIX sh 未定义此选项。
# shellcheck disable=SC3040
set -o pipefail
umask 077

BACKUP_DIR="${BACKUP_DIR:-/backups}"
DB_HOST="${DB_HOST:-insuredesk-db-prod}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
# 每晚 21:30（容器 TZ=Asia/Shanghai）；新鲜度阈值 = 日备周期 + 1h 余量 = 25h，
# 避开 21:30 边界抖动。均可被环境变量覆盖，便于测试。
BACKUP_SCHEDULE="${BACKUP_SCHEDULE:-30 21 * * *}"
FRESH_MINUTES="${FRESH_MINUTES:-1500}"

backup_once() {
  mkdir -p "$BACKUP_DIR"

  ts="$(date +%Y%m%d-%H%M%S)"
  out="$BACKUP_DIR/insuredesk-$ts.sql.gz"
  tmp="$out.part"
  # 先写 .part 再原子改名：pg_dump 中途失败不会留下貌似完整的备份文件。
  trap 'rm -f "$tmp"' EXIT

  # 账号/库/密码读容器环境（compose 从 .env 注入），与 db 服务同源一份。
  PGPASSWORD="$POSTGRES_PASSWORD" \
    pg_dump -h "$DB_HOST" -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip -c >"$tmp"
  gzip -t "$tmp"
  mv "$tmp" "$out"
  trap - EXIT

  find "$BACKUP_DIR" -name 'insuredesk-*.sql.gz' -mtime "+$RETENTION_DAYS" -delete

  echo "backup ok: $out ($(du -h "$out" | cut -f1))"
}

serve() {
  backup_once

  # crond 是 PID 1，其 stdout 即容器 stdout；子任务输出重定向到 /proc/1/fd/1
  # 才进 docker logs。busybox crond 把容器环境透传给子任务，故 cron 里的
  # pg_dump 同样拿得到 PGPASSWORD 等；$0 由 compose 以绝对路径传入。
  printf '%s sh %s once > /proc/1/fd/1 2>&1\n' "$BACKUP_SCHEDULE" "$0" | crontab -
  echo "backup scheduled: '$BACKUP_SCHEDULE' (TZ=${TZ:-UTC})"
  exec crond -f -d 8
}

check() {
  if find "$BACKUP_DIR" -name 'insuredesk-*.sql.gz' -type f -mmin "-$FRESH_MINUTES" \
    | grep -q .; then
    exit 0
  fi
  echo "no fresh backup in $BACKUP_DIR within ${FRESH_MINUTES}min" >&2
  exit 1
}

case "${1:-once}" in
once) backup_once ;;
serve) serve ;;
check) check ;;
*)
  echo "usage: $0 {once|serve|check}" >&2
  exit 2
  ;;
esac
