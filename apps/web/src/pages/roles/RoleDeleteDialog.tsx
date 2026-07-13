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
import { AlertCircle } from "lucide-react";
import { toast } from "sonner";
import type { RoleRow } from "./RolesPage";

/**
 * 删除角色 (role.delete): explicit confirm — roles are configuration with no
 * undo. The 管理员 system role never reaches here (the button is hidden), and
 * the server refuses roles that still have holders; the in-dialog alert
 * surfaces that refusal.
 */
export function RoleDeleteDialog({
  role,
  onOpenChange,
}: {
  role: RoleRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();

  const remove = trpc.role.delete.useMutation({
    onSuccess: () => {
      toast.success("角色已删除");
      utils.role.list.invalidate();
      utils.user.roleOptions.invalidate();
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={role !== null} onOpenChange={(next) => !remove.isPending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>删除角色</DialogTitle>
          <DialogDescription>
            {role &&
              (role.userCount > 0
                ? `「${role.name}」下仍有 ${role.userCount} 个用户，需先为他们分配其他角色后才能删除。`
                : `确定删除角色「${role.name}」吗？删除后不可恢复。`)}
          </DialogDescription>
        </DialogHeader>

        {remove.error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>删除失败</AlertTitle>
            <AlertDescription>{remove.error.message}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={remove.isPending}>
              取消
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            disabled={remove.isPending || (role?.userCount ?? 0) > 0}
            onClick={() => role && remove.mutate({ id: role.id })}
          >
            {remove.isPending && <Spinner data-icon="inline-start" />}
            {remove.isPending ? "删除中…" : "确认删除"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
