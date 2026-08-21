import { AlertCircle } from "lucide-react";
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
import { toast } from "@/lib/toast";
import { trpc } from "@/lib/trpc";
import type { UserRow } from "./UsersPage";

export function DisableUserDialog({
  user,
  onOpenChange,
}: {
  user: UserRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();

  const disable = trpc.user.setActive.useMutation({
    onSuccess: (result) => {
      toast.success(`已禁用用户 ${result.name}`);
      utils.user.list.invalidate();
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={user !== null} onOpenChange={(next) => !disable.isPending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>禁用用户</DialogTitle>
          <DialogDescription>
            {user &&
              `确定禁用 ${user.name}（${user.username}）吗？禁用后无法登录，已登录的会话下一次请求即被拒绝；名下工单与排班不受影响，可随时重新启用。`}
          </DialogDescription>
        </DialogHeader>

        {disable.error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>禁用失败</AlertTitle>
            <AlertDescription>{disable.error.message}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={disable.isPending}>
              取消
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            disabled={disable.isPending}
            onClick={() => user && disable.mutate({ id: user.id, active: false })}
          >
            {disable.isPending && <Spinner data-icon="inline-start" />}
            {disable.isPending ? "禁用中…" : "确认禁用"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
