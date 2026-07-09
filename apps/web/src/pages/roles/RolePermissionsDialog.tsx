import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { trpc } from "@/lib/trpc";
import type { Permission } from "@insuredesk/shared";
import { AlertCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PermissionChecklist } from "./PermissionChecklist";
import type { RoleRow } from "./RolesPage";

/**
 * 权限配置 (role.edit_permission) — and the read-only 查看权限 view for
 * preset roles or viewers without the point. Saving replaces the full set;
 * every holder is re-judged on their next request (即时生效).
 */
export function RolePermissionsDialog({
  role,
  editable,
  onOpenChange,
}: {
  role: RoleRow | null;
  /** Whether the viewer holds role.edit_permission — preset roles stay read-only regardless. */
  editable: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const open = role !== null;
  const canEdit = editable && role !== null && !role.preset;
  const [permissions, setPermissions] = useState<Permission[]>([]);

  useEffect(() => {
    if (role) {
      setPermissions(role.permissions);
    }
  }, [role]);

  const update = trpc.role.updatePermissions.useMutation({
    onSuccess: (result) => {
      toast.success(`已更新「${result.name}」的权限，成员下一次请求起生效`);
      utils.role.list.invalidate();
      onOpenChange(false);
    },
  });

  const busy = update.isPending;

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="flex max-h-[min(720px,90svh)] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{canEdit ? "配置权限" : "查看权限"}</DialogTitle>
          <DialogDescription>
            {role &&
              (canEdit
                ? `勾选「${role.name}」可用的权限点，保存后自成员下一次请求起生效。`
                : role.preset
                  ? `「${role.name}」是预设角色，权限为固定基线，不可修改。`
                  : `「${role.name}」的权限清单（无编辑权限，仅可查看）。`)}
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto pr-1">
          <PermissionChecklist
            value={permissions}
            onChange={canEdit ? setPermissions : undefined}
            disabled={!canEdit}
          />
        </div>

        {update.error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>保存失败</AlertTitle>
            <AlertDescription>{update.error.message}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={busy}>
              {canEdit ? "取消" : "关闭"}
            </Button>
          </DialogClose>
          {canEdit && (
            <Button
              type="button"
              disabled={busy}
              onClick={() => role && update.mutate({ id: role.id, permissions })}
            >
              {busy && <Spinner data-icon="inline-start" />}
              {busy ? "保存中…" : "保存"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
