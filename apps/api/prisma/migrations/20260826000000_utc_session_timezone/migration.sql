-- adapter-pg 把 DateTime 序列化为无偏移的 UTC 墙钟串、交给会话时区解析（读路径
-- 再把偏移改写为 +00:00）：本会话此前是 Asia/Shanghai，存量 app 写入值一律 -8h。
-- 目录四表由迁移 SQL 直接播种（正确瞬间）且时间列仅作展示，不在修正范围：
-- ticket_kinds / completion_statuses / user_feedback_channels / feedback_receive_channels。
DO $$
BEGIN
    EXECUTE format('ALTER DATABASE %I SET timezone = ''UTC''', current_database());
END $$;

-- 单条 DO 语句：任一 UPDATE 失败整体回滚，+8h 修正不得半程或二次应用。
DO $$
DECLARE
    target text[];
    targets text[][] := ARRAY [
        ['users', 'createdAt'], ['users', 'updatedAt'],
        ['roles', 'createdAt'], ['roles', 'updatedAt'],
        ['tickets', 'createdAt'], ['tickets', 'updatedAt'],
        ['tickets', 'feedbackTime'], ['tickets', 'slaAnchorAt'],
        ['tickets', 'contactTime'], ['tickets', 'assignedAt'],
        ['tickets', 'dueAt'], ['tickets', 'nextContactTime'],
        ['tickets', 'completionTime'], ['tickets', 'deletedAt'],
        ['ticket_import_batches', 'importedAt'], ['ticket_import_batches', 'revokedAt'],
        ['process_logs', 'at'],
        ['sla_policies', 'createdAt'], ['sla_policies', 'updatedAt'],
        ['ticket_refund_details', 'refundCreateTime'], ['ticket_refund_details', 'createdAt'],
        ['ticket_refund_details', 'updatedAt'],
        ['callback_deliveries', 'firstAttemptAt'], ['callback_deliveries', 'nextAttemptAt'],
        ['callback_deliveries', 'deliveredAt'], ['callback_deliveries', 'createdAt'],
        ['callback_deliveries', 'updatedAt'],
        ['ticket_categories', 'createdAt'], ['ticket_categories', 'updatedAt'],
        ['channels', 'createdAt'], ['channels', 'updatedAt'],
        ['shift_types', 'createdAt'], ['shift_types', 'updatedAt'],
        ['schedules', 'createdAt'], ['schedules', 'updatedAt'],
        ['app_notifications', 'createdAt'],
        ['sessions', 'expiresAt'], ['sessions', 'createdAt']
    ];
BEGIN
    FOREACH target SLICE 1 IN ARRAY targets LOOP
        EXECUTE format(
            'UPDATE %I SET %I = %I + interval ''8 hours'' WHERE %I IS NOT NULL',
            target[1], target[2], target[2], target[2]
        );
    END LOOP;
END $$;
