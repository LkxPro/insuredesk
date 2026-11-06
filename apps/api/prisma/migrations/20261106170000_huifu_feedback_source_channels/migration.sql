WITH planned (name, position) AS (
  VALUES
    ('支付400热线', 1),
    ('在线客服', 2),
    ('客服邮箱', 3),
    ('黑猫', 4),
    ('人行专线', 5),
    ('消保委市监局', 6),
    ('汇付官网', 7),
    ('微信', 8),
    ('支付宝', 9),
    ('企微群投诉', 10),
    ('小程序投诉', 11),
    ('人行消保', 12),
    ('人行信访', 13),
    ('协会', 14),
    ('服务号', 15),
    ('银行', 16),
    ('消费保', 17)
), missing AS (
  SELECT name, ROW_NUMBER() OVER (ORDER BY position) AS position
  FROM planned
  WHERE NOT EXISTS (
    SELECT 1 FROM "user_feedback_channels" existing WHERE existing.name = planned.name
  )
), current_order AS (
  SELECT COALESCE(MAX("displayOrder"), 0) AS maximum FROM "user_feedback_channels"
)
INSERT INTO "user_feedback_channels" ("id", "name", "displayOrder", "updatedAt")
SELECT gen_random_uuid()::text, missing.name,
       (current_order.maximum + missing.position)::integer, CURRENT_TIMESTAMP
FROM missing CROSS JOIN current_order
ON CONFLICT ("name") DO NOTHING;
