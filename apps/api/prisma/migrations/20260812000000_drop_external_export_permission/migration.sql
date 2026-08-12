-- 外部导出权限位已不在权限点清单里。存量库的角色权限数组仍留着这个字符串，
-- 摘掉它——读路径只做 cast 不会报错，但权限编辑回填的正是库中数组，带着这个
-- 字符串提交会被 rolePermissionsSchema 整体拒绝，让角色再也存不下去。

UPDATE "roles"
SET "permissions" = array_remove("permissions", 'ticket.export_external')
WHERE "permissions" @> ARRAY['ticket.export_external'];
