import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { trpc } from "@/lib/trpc";
import type { AppRouter } from "@insuredesk/api";
import type { inferRouterOutputs } from "@trpc/server";
import { AlertCircle, Plus } from "lucide-react";
import { useState } from "react";
import { RoleCreateDialog } from "./RoleCreateDialog";
import { RoleDeleteDialog } from "./RoleDeleteDialog";
import { RolePermissionsDialog } from "./RolePermissionsDialog";
import { RoleRenameDialog } from "./RoleRenameDialog";

/**
 * 角色权限: custom roles configured against the 权限点清单. role.view opens
 * the page (route-guarded); each operation appears only with its own point —
 * role.create / role.edit / role.delete / role.edit_permission — and the API
 * re-checks regardless. The four preset roles are a fixed baseline: viewable
 * but never renamed, re-permissioned, or deleted.
 */

export type RoleRow = inferRouterOutputs<AppRouter>["role"]["list"][number];

export function RolesPage() {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission("role.create");
  const canRename = hasPermission("role.edit");
  const canDelete = hasPermission("role.delete");
  const canEditPermissions = hasPermission("role.edit_permission");

  const listQuery = trpc.role.list.useQuery();

  const [createOpen, setCreateOpen] = useState(false);
  const [permissionsTarget, setPermissionsTarget] = useState<RoleRow | null>(null);
  const [renameTarget, setRenameTarget] = useState<RoleRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RoleRow | null>(null);

  const roles = listQuery.data ?? [];

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">角色权限</h1>
          <p className="text-sm text-muted-foreground">
            按权限点清单配置自定义角色；权限变更自成员下一次请求起生效，预设角色受保护。
          </p>
        </div>
        {canCreate && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus data-icon="inline-start" />
            新增角色
          </Button>
        )}
      </div>

      {listQuery.error ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>角色列表加载失败</AlertTitle>
          <AlertDescription>{listQuery.error.message}</AlertDescription>
        </Alert>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>角色名称</TableHead>
                <TableHead>类型</TableHead>
                <TableHead>权限点</TableHead>
                <TableHead>用户数</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {listQuery.isLoading &&
                [1, 2, 3, 4].map((row) => (
                  <TableRow key={row}>
                    {[1, 2, 3, 4, 5].map((cell) => (
                      <TableCell key={cell}>
                        <Skeleton className="h-5 w-full max-w-24" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              {!listQuery.isLoading && roles.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                    暂无角色
                  </TableCell>
                </TableRow>
              )}
              {roles.map((role) => (
                <TableRow key={role.id}>
                  <TableCell className="font-medium">{role.name}</TableCell>
                  <TableCell>
                    {role.preset ? (
                      <Badge variant="secondary">预设</Badge>
                    ) : (
                      <Badge variant="outline">自定义</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {role.permissions.length} 项
                  </TableCell>
                  <TableCell className="text-muted-foreground">{role.userCount}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setPermissionsTarget(role)}>
                        {canEditPermissions && !role.preset ? "配置权限" : "查看权限"}
                      </Button>
                      {canRename && !role.preset && (
                        <Button variant="ghost" size="sm" onClick={() => setRenameTarget(role)}>
                          重命名
                        </Button>
                      )}
                      {canDelete && !role.preset && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(role)}
                        >
                          删除
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {canCreate && <RoleCreateDialog open={createOpen} onOpenChange={setCreateOpen} />}
      <RolePermissionsDialog
        role={permissionsTarget}
        editable={canEditPermissions}
        onOpenChange={(open) => {
          if (!open) setPermissionsTarget(null);
        }}
      />
      {canRename && (
        <RoleRenameDialog
          role={renameTarget}
          onOpenChange={(open) => {
            if (!open) setRenameTarget(null);
          }}
        />
      )}
      {canDelete && (
        <RoleDeleteDialog
          role={deleteTarget}
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
        />
      )}
    </div>
  );
}
