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
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { trpc } from "@/lib/trpc";
import type { OrgUserRow } from "./ExternalOrgDetailPage";

/**
 * 换角色 (external_org.manage): 外部角色间互换，机构绑定不动 — the API
 * refuses internal roles outright, so the dropdown offers external ones only.
 */
export function OrgUserAssignRoleDialog({
  user,
  onOpenChange,
}: {
  user: OrgUserRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const open = user !== null;
  const [roleId, setRoleId] = useState("");

  useEffect(() => {
    if (user) {
      setRoleId(user.roleId);
    }
  }, [user]);

  const roleOptions = trpc.externalOrg.externalRoleOptions.useQuery(undefined, { enabled: open });

  const assign = trpc.externalOrg.assignUserRole.useMutation({
    onSuccess: (result) => {
      toast.success(`已将 ${result.name} 的角色调整为「${result.roleName}」`);
      utils.externalOrg.invalidate();
      onOpenChange(false);
    },
  });

  const busy = assign.isPending;

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>换角色</DialogTitle>
          <DialogDescription>
            {user && `调整 ${user.name} 的角色，仅限外部角色，所属机构不变。`}
          </DialogDescription>
        </DialogHeader>

        <Field>
          <FieldLabel htmlFor="org-user-assign-role">角色</FieldLabel>
          <Select value={roleId} onValueChange={setRoleId}>
            <SelectTrigger
              id="org-user-assign-role"
              className="w-full"
              disabled={roleOptions.isLoading}
            >
              <SelectValue placeholder="请选择外部角色" />
            </SelectTrigger>
            <SelectContent>
              {(roleOptions.data ?? []).map((role) => (
                <SelectItem key={role.id} value={role.id}>
                  {role.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {assign.error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>换角色失败</AlertTitle>
            <AlertDescription>{assign.error.message}</AlertDescription>
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
            disabled={busy || !roleId || roleId === user?.roleId}
            onClick={() => user && assign.mutate({ id: user.id, roleId })}
          >
            {busy && <Spinner data-icon="inline-start" />}
            {busy ? "调整中…" : "确认"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
