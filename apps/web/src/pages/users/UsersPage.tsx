import type { AppRouter } from "@insuredesk/api";
import type { inferRouterOutputs } from "@trpc/server";
import { AlertCircle, Plus } from "lucide-react";
import { useState } from "react";
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
import { formatDateTime } from "@/lib/datetime";
import { toast } from "@/lib/toast";
import { trpc } from "@/lib/trpc";
import { AssignRoleDialog } from "./AssignRoleDialog";
import { DisableUserDialog } from "./DisableUserDialog";
import { UserCreateDialog } from "./UserCreateDialog";
import { UserEditDialog } from "./UserEditDialog";

/**
 * 外部账号 are managed on the 外部账号管理 page and never appear here.
 * Disabled accounts stay listed so they can be re-enabled; 启用 fires
 * directly (harmless), 禁用 confirms first (kicks the user's live sessions).
 */
export type UserRow = inferRouterOutputs<AppRouter>["user"]["list"][number];

export function UsersPage() {
  const { user: me, hasPermission } = useAuth();
  const canCreate = hasPermission("user.create");
  const canEdit = hasPermission("user.edit");
  const canToggleActive = hasPermission("user.delete");
  const canAssignRole = hasPermission("user.assign_role");

  const utils = trpc.useUtils();
  const listQuery = trpc.user.list.useQuery();

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<UserRow | null>(null);
  const [assignTarget, setAssignTarget] = useState<UserRow | null>(null);
  const [disableTarget, setDisableTarget] = useState<UserRow | null>(null);

  const enable = trpc.user.setActive.useMutation({
    onSuccess: (result) => {
      toast.success(`已启用用户 ${result.name}`);
      utils.user.list.invalidate();
    },
    onError: (error) => toast.error(`启用失败：${error.message}`),
  });

  const users = listQuery.data ?? [];

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">用户管理</h1>
          <p className="text-sm text-muted-foreground">
            新增、编辑、禁用/启用内部账号并分配角色；禁用后无法登录，已有会话即刻失效。外部账号在外部账号管理页维护。
          </p>
        </div>
        {canCreate && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus data-icon="inline-start" />
            新增用户
          </Button>
        )}
      </div>

      {listQuery.error ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>用户列表加载失败</AlertTitle>
          <AlertDescription>{listQuery.error.message}</AlertDescription>
        </Alert>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>姓名</TableHead>
                <TableHead>用户名</TableHead>
                <TableHead>邮箱</TableHead>
                <TableHead>团队</TableHead>
                <TableHead>角色</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {listQuery.isLoading &&
                [1, 2, 3].map((row) => (
                  <TableRow key={row}>
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((cell) => (
                      <TableCell key={cell}>
                        <Skeleton className="h-5 w-full max-w-24" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              {!listQuery.isLoading && users.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                    暂无用户
                  </TableCell>
                </TableRow>
              )}
              {users.map((user) => (
                <TableRow key={user.id} className={user.active ? undefined : "opacity-60"}>
                  <TableCell className="font-medium">
                    {user.name}
                    {user.id === me?.id && (
                      <span className="ml-1 text-xs text-muted-foreground">（我）</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{user.username}</TableCell>
                  <TableCell className="text-muted-foreground">{user.email ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{user.team ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={user.roleSystem ? "secondary" : "outline"}>
                      {user.roleName}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {user.active ? (
                      <Badge variant="outline">启用</Badge>
                    ) : (
                      <Badge variant="destructive">已禁用</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDateTime(user.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {canEdit && (
                        <Button variant="ghost" size="sm" onClick={() => setEditTarget(user)}>
                          编辑
                        </Button>
                      )}
                      {canAssignRole && (
                        <Button variant="ghost" size="sm" onClick={() => setAssignTarget(user)}>
                          分配角色
                        </Button>
                      )}
                      {/* 自禁用会当场锁死操作者，服务端同样拒绝 */}
                      {canToggleActive &&
                        user.id !== me?.id &&
                        (user.active ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setDisableTarget(user)}
                          >
                            禁用
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={enable.isPending}
                            onClick={() => enable.mutate({ id: user.id, active: true })}
                          >
                            启用
                          </Button>
                        ))}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {canCreate && <UserCreateDialog open={createOpen} onOpenChange={setCreateOpen} />}
      {canEdit && (
        <UserEditDialog
          user={editTarget}
          onOpenChange={(open) => {
            if (!open) setEditTarget(null);
          }}
        />
      )}
      {canAssignRole && (
        <AssignRoleDialog
          user={assignTarget}
          onOpenChange={(open) => {
            if (!open) setAssignTarget(null);
          }}
        />
      )}
      {canToggleActive && (
        <DisableUserDialog
          user={disableTarget}
          onOpenChange={(open) => {
            if (!open) setDisableTarget(null);
          }}
        />
      )}
    </div>
  );
}
