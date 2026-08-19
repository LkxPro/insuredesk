#!/usr/bin/env bash
# 迁移演练：从空库重放到目标迁移之前，灌入遗留值，再单跑目标迁移验证回填。
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

CONTAINER="${1:?db container name}"
DB="${2:-rehearsal}"
TARGET="${3:-20260819120000_complaint_channel_catalogs}"

docker exec "$CONTAINER" psql -U insuredesk -d postgres -c "DROP DATABASE IF EXISTS $DB;" -c "CREATE DATABASE $DB;" -q

for d in $(ls apps/api/prisma/migrations | sort); do
  [ "$d" = "migration_lock.toml" ] && continue
  [ "$d" \< "$TARGET" ] || continue
  docker exec -i "$CONTAINER" psql -U insuredesk -d "$DB" -v ON_ERROR_STOP=1 -q -f - < "apps/api/prisma/migrations/$d/migration.sql"
done
echo "REPLAY-OK (before $TARGET)"
