-- 外部导出权限位默认开启（issue #187）：种子只管新建库，存量外部角色在此补点。
-- 外部角色按 marker 点（提交/留言）判定，与 isExternalRole 同口径。

UPDATE "roles"
SET "permissions" = array_append("permissions", 'ticket.export_external')
WHERE "system" = false
  AND "permissions" && ARRAY['ticket.create_external', 'ticket.process_external']
  AND NOT "permissions" @> ARRAY['ticket.export_external'];
