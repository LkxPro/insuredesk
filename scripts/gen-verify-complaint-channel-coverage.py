"""从迁移 SQL 机械生成生产覆盖核对脚本。"""
import re

MIGRATION = 'apps/api/prisma/migrations/20260819120000_complaint_channel_catalogs/migration.sql'
OUT = 'scripts/verify-complaint-channel-coverage.sql'

sql = open(MIGRATION).read()

def extract_map(map_name):
    body = re.search(map_name + r'" \("old", "new"\) VALUES\n(.*?);', sql, re.S).group(1)
    return re.findall(r"\('((?:[^']|'')*)', (?:NULL|'(?:[^']|'')*')\)", body)

def extract_catalog(table):
    body = re.search(r'INSERT INTO "' + table + r'" .*? VALUES\n(.*?);', sql, re.S).group(1)
    return re.findall(r"\(gen_random_uuid\(\)::text, '((?:[^']|'')*)',", body)

def sql_list(values):
    return ','.join(f"'{v}'" for v in values)

def uncovered_query(table_col, table, keys):
    return f"""SELECT DISTINCT "{table_col}" AS uncovered, count(*)
FROM {table}
WHERE "{table_col}" IS NOT NULL AND "{table_col}" <> ''
  AND "{table_col}" NOT IN ({sql_list(keys)})
GROUP BY 1 ORDER BY 2 DESC;"""

def uncovered_query_scalar(table_col, table, keys):
    return f"""SELECT DISTINCT "{table_col}" AS uncovered
FROM {table}
WHERE "{table_col}" IS NOT NULL AND "{table_col}" <> ''
  AND "{table_col}" NOT IN ({sql_list(keys)});"""

ucc_keys = extract_map('_map_user_complaint_channel')
crc_keys = extract_map('_map_complaint_receive_channel')
ucc_names = extract_catalog('user_complaint_channels')
crc_names = extract_catalog('complaint_receive_channels')

header = """-- 发版前核对（由迁移 SQL 机械生成，勿手改——改动映射后跑 scripts/gen-verify-complaint-channel-coverage.py 重新生成）：
-- 生产库两字段 + 外部账号预填的现存非空值中，落在迁移映射表/目录之外的值。
-- 期望：四个查询全部 0 行。有行返回 → 把值发给产品指认映射，补进
-- migration.sql 的 _map_* 表后再发版。
"""

parts = [
    uncovered_query('userComplaintChannel', 'tickets', ucc_keys),
    uncovered_query('complaintReceiveChannel', 'tickets', crc_keys),
    uncovered_query_scalar('prefillUserComplaintChannel', 'users', ucc_names),
    uncovered_query_scalar('prefillComplaintReceiveChannel', 'users', crc_names),
]
open(OUT, 'w').write(header + '\n' + '\n'.join(parts) + '\n')
print(f'ucc_keys={len(ucc_keys)} crc_keys={len(crc_keys)} ucc_names={len(ucc_names)} crc_names={len(crc_names)} -> {OUT}')
