INSERT INTO "feedback_receive_channels" ("id", "name", "displayOrder", "updatedAt")
SELECT gen_random_uuid()::text, '汇付400工单投诉', COALESCE(MAX("displayOrder"), 0) + 1, CURRENT_TIMESTAMP
FROM "feedback_receive_channels"
ON CONFLICT ("name") DO NOTHING;
