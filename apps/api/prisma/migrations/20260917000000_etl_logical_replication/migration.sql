BEGIN;

-- REPLICATION 属性是 cluster 级:wal_level=logical + max_wal_senders 由运维在
-- 服务器上 ALTER SYSTEM 设置（需重启）,迁移本身只补角色属性与库内对象。
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'etl_ro') THEN
    ALTER ROLE etl_ro WITH REPLICATION;
  END IF;
END $$;

-- 静态表级 publication,白名单与 SELECT 授权保持一致。不用 FOR ALL TABLES:
-- 新增敏感表会被 default privileges 自动开 SELECT,若 publication 也自动全收,
-- 等于复制流绕过白名单;代价是新表需 ALTER PUBLICATION ... ADD TABLE 显式加入。
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_publication WHERE pubname = 'etl_pub') THEN
    CREATE PUBLICATION etl_pub FOR TABLE
      tickets, ticket_complaint_details, ticket_refund_details, process_logs,
      ticket_import_batches, sla_policies, ticket_kinds, ticket_categories,
      channels, completion_statuses, user_feedback_channels, feedback_receive_channels;
  END IF;
END $$;

-- pg_hba 需补 host replication etl_ro <源> scram-sha-256（服务器侧手工追加,
-- 与 host all all all 同模式）。

COMMIT;
