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
import { ExternalOrgField, isExternalRoleOption } from "./ExternalOrgField";
import type { UserRow } from "./UsersPage";

/**
 * 分配角色 (user.assign_role): swap the user's role. Sessions resolve
 * permissions from the role per request, so the change takes effect on the
 * target's very next request — no re-login needed. Role and 所属外部机构 move
 * together here: this is the only door onto an 外部角色.
 */
export function AssignRoleDialog({
  user,
  onOpenChange,
}: {
  user: UserRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const open = user !== null;
  const [roleId, setRoleId] = useState("");
  const [externalOrgId, setExternalOrgId] = useState("");

  useEffect(() => {
    if (user) {
      setRoleId(user.roleId);
      setExternalOrgId(user.externalOrgId ?? "");
    }
  }, [user]);

  const roleOptions = trpc.user.roleOptions.useQuery(undefined, { enabled: open });
  const isExternal = isExternalRoleOption(roleOptions.data, roleId);

  const assign = trpc.user.assignRole.useMutation({
    onSuccess: (result) => {
      toast.success(`已将 ${result.name} 的角色调整为「${result.roleName}」`);
      utils.user.list.invalidate();
      onOpenChange(false);
    },
  });

  const busy = assign.isPending;
  const unchanged = roleId === user?.roleId && externalOrgId === (user?.externalOrgId ?? "");

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>分配角色</DialogTitle>
          <DialogDescription>
            {user && `调整 ${user.name} 的角色，新权限自其下一次请求起生效。`}
          </DialogDescription>
        </DialogHeader>

        <Field>
          <FieldLabel htmlFor="assign-role">角色</FieldLabel>
          <Select
            value={roleId}
            onValueChange={(next) => {
              setRoleId(next);
              setExternalOrgId(
                isExternalRoleOption(roleOptions.data, next) ? (user?.externalOrgId ?? "") : "",
              );
            }}
          >
            <SelectTrigger id="assign-role" className="w-full" disabled={roleOptions.isLoading}>
              <SelectValue placeholder="请选择角色" />
            </SelectTrigger>
            <SelectContent>
              {(roleOptions.data ?? []).map((role) => (
                <SelectItem key={role.id} value={role.id}>
                  {role.name}
                  {role.system && "（系统）"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {isExternal && (
          <ExternalOrgField
            id="assign-external-org"
            value={externalOrgId}
            onChange={setExternalOrgId}
          />
        )}

        {assign.error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>分配失败</AlertTitle>
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
            disabled={busy || !roleId || unchanged || (isExternal && !externalOrgId)}
            onClick={() => user && assign.mutate({ id: user.id, roleId, externalOrgId })}
          >
            {busy && <Spinner data-icon="inline-start" />}
            {busy ? "分配中…" : "确认"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
