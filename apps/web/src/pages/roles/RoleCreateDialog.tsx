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
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { trpc } from "@/lib/trpc";
import type { Permission } from "@insuredesk/shared";
import { AlertCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PermissionChecklist } from "./PermissionChecklist";

/**
 * 新增角色 (role.create): a name plus the permission checklist. An empty
 * permission set is allowed — such a role simply sees nothing until
 * configured (the server treats permissions as data, not a minimum).
 */
export function RoleCreateDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [permissions, setPermissions] = useState<Permission[]>([]);

  useEffect(() => {
    if (open) {
      setName("");
      setPermissions([]);
    }
  }, [open]);

  const create = trpc.role.create.useMutation({
    onSuccess: (result) => {
      toast.success(`已创建角色「${result.name}」`);
      utils.role.list.invalidate();
      utils.user.roleOptions.invalidate();
      onOpenChange(false);
    },
  });

  const busy = create.isPending;
  const trimmedName = name.trim();

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="flex max-h-[min(720px,90svh)] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>新增角色</DialogTitle>
          <DialogDescription>按 PRD §5.1 权限点清单勾选该角色可用的权限。</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 overflow-y-auto pr-1">
          <Field data-invalid={trimmedName.length > 50}>
            <FieldLabel htmlFor="role-name">角色名称</FieldLabel>
            <Input
              id="role-name"
              value={name}
              maxLength={50}
              onChange={(event) => setName(event.target.value)}
              placeholder="如：质检专员"
            />
            {trimmedName.length > 50 && <FieldError>角色名称最长 50 字符</FieldError>}
          </Field>

          <PermissionChecklist value={permissions} onChange={setPermissions} />
        </div>

        {create.error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>创建失败</AlertTitle>
            <AlertDescription>{create.error.message}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={busy}>
              取消
            </Button>
          </DialogClose>
          <Button
            type="button"
            disabled={busy || !trimmedName}
            onClick={() => create.mutate({ name: trimmedName, permissions })}
          >
            {busy && <Spinner data-icon="inline-start" />}
            {busy ? "创建中…" : "创建"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
