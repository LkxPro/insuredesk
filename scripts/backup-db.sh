#!/bin/bash
# 生产数据库备份（ADR 0009）：从 db 容器 pg_dump 到本机目录，保留 14 天。
# 由宿主机 cron 每日调用，也用于升级前的固定手动备份（docs/releasing.md）。
# 仅本机备份、无异地副本的已知风险见 ADR 0009。
#
# cron 配置与恢复步骤见 docs/deployment.md → 备份与恢复。
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/insuredesk}"
CONTAINER="${CONTAINER:-insuredesk-db-prod}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

mkdir -p "$BACKUP_DIR"

# 先写 .part 再原子改名：pg_dump 中途失败不会留下貌似完整的备份文件。
ts="$(date +%Y%m%d-%H%M%S)"
out="$BACKUP_DIR/insuredesk-$ts.sql.gz"
tmp="$out.part"
trap 'rm -f "$tmp"' EXIT

# 库名/账号读容器自身的环境变量，避免与服务器 .env 各写一份。
docker exec "$CONTAINER" sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' \
  | gzip > "$tmp"
mv "$tmp" "$out"

find "$BACKUP_DIR" -name 'insuredesk-*.sql.gz' -mtime "+$RETENTION_DAYS" -delete

echo "backup ok: $out ($(du -h "$out" | cut -f1))"
