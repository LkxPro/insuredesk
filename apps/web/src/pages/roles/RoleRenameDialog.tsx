import { AlertCircle } from "lucide-react";
import { useEffect, useState } from "react";
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
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/lib/toast";
import { trpc } from "@/lib/trpc";
import type { RoleRow } from "./RolesPage";

export function RoleRenameDialog({
  role,
  onOpenChange,
}: {
  role: RoleRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const [name, setName] = useState("");

  useEffect(() => {
    if (role) {
      setName(role.name);
    }
  }, [role]);

  const rename = trpc.role.rename.useMutation({
    onSuccess: (result) => {
      toast.success(`已重命名为「${result.name}」`);
      utils.role.list.invalidate();
      utils.user.list.invalidate();
      utils.user.roleOptions.invalidate();
      onOpenChange(false);
    },
  });

  const busy = rename.isPending;
  const trimmedName = name.trim();

  return (
    <Dialog open={role !== null} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>重命名角色</DialogTitle>
          <DialogDescription>
            {role && `将「${role.name}」改名，成员的角色标签随之更新。`}
          </DialogDescription>
        </DialogHeader>

        <Field>
          <FieldLabel htmlFor="rename-role">角色名称</FieldLabel>
          <Input
            id="rename-role"
            value={name}
            maxLength={50}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>

        {rename.error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>重命名失败</AlertTitle>
            <AlertDescription>{rename.error.message}</AlertDescription>
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
            disabled={busy || !trimmedName || trimmedName === role?.name}
            onClick={() => role && rename.mutate({ id: role.id, name: trimmedName })}
          >
            {busy && <Spinner data-icon="inline-start" />}
            {busy ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
