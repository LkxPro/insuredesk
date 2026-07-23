import type { Permission, TicketCreateFieldKey } from "@insuredesk/shared";
import { AlertCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
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
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { trpc } from "@/lib/trpc";
import { PermissionChecklist } from "./PermissionChecklist";
import { RequiredFieldsChecklist } from "./RequiredFieldsChecklist";
import type { RoleRow } from "./RolesPage";

/**
 * 权限配置 (role.edit_permission) — and the read-only 查看权限 view for the
 * 管理员 system role or viewers without the point. Saving replaces the full
 * set; every holder is re-judged on their next request (即时生效).
 *
 * 同时配置角色建单必填字段：权限点与必填集在同一对话框编辑，分两个 mutation 提交
 * （权限立即生效，必填集在下次建单时生效）。
 */
export function RolePermissionsDialog({
  role,
  editable,
  onOpenChange,
}: {
  role: RoleRow | null;
  /** Whether the viewer holds role.edit_permission — the system role stays read-only regardless. */
  editable: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const open = role !== null;
  const canEdit = editable && role !== null && !role.system;
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [requiredFields, setRequiredFields] = useState<TicketCreateFieldKey[]>([]);

  useEffect(() => {
    if (role) {
      setPermissions(role.permissions);
      setRequiredFields(role.requiredTicketFields as TicketCreateFieldKey[]);
    }
  }, [role]);

  const updatePermissions = trpc.role.updatePermissions.useMutation({
    onSuccess: (result) => {
      toast.success(`已更新「${result.name}」的权限，成员下一次请求起生效`);
      utils.role.list.invalidate();
      onOpenChange(false);
    },
  });

  const updateRequiredFields = trpc.role.updateRequiredFields.useMutation({
    onSuccess: (result) => {
      toast.success(`已更新「${result.name}」的建单必填字段`);
      utils.role.list.invalidate();
      onOpenChange(false);
    },
  });

  const busy = updatePermissions.isPending || updateRequiredFields.isPending;

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="flex max-h-[min(720px,90svh)] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{canEdit ? "配置权限" : "查看权限"}</DialogTitle>
          <DialogDescription>
            {role &&
              (canEdit
                ? `勾选「${role.name}」可用的权限点，保存后自成员下一次请求起生效。`
                : role.system
                  ? `「${role.name}」是系统角色，恒为全部正向权限（不含限制类），不可修改。`
                  : `「${role.name}」的权限清单（无编辑权限，仅可查看）。`)}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
          <div>
            <h3 className="mb-3 text-sm font-medium">权限点</h3>
            <PermissionChecklist
              value={permissions}
              onChange={canEdit ? setPermissions : undefined}
              disabled={!canEdit}
            />
          </div>

          <Separator />

          <div>
            <h3 className="mb-3 text-sm font-medium">建单必填字段</h3>
            <RequiredFieldsChecklist
              value={requiredFields}
              onChange={canEdit ? setRequiredFields : undefined}
              disabled={!canEdit}
            />
          </div>
        </div>

        {(updatePermissions.error || updateRequiredFields.error) && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>保存失败</AlertTitle>
            <AlertDescription>
              {updatePermissions.error?.message || updateRequiredFields.error?.message}
            </AlertDescription>
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
              onClick={() => {
                if (!role) return;
                Promise.all([
                  updatePermissions.mutateAsync({ id: role.id, permissions }),
                  updateRequiredFields.mutateAsync({
                    id: role.id,
                    requiredTicketFields: requiredFields,
                  }),
                ]).catch(() => {
                  // Errors are already displayed via the Alert components
                });
              }}
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
