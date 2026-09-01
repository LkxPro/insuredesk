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

export function RevokeApiKeysDialog({
  user,
  onOpenChange,
}: {
  user: UserRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const revokeAll = trpc.apiKey.revokeAllForUser.useMutation({
    onSuccess: (result) => {
      toast.success(`已吊销 ${result.revoked} 个 API key`);
      onOpenChange(false);
    },
  });

  return (
    <Dialog
      open={user !== null}
      onOpenChange={(next) => !revokeAll.isPending && onOpenChange(next)}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>吊销全部 API key</DialogTitle>
          <DialogDescription>
            {user &&
              `确定吊销 ${user.name}（${user.username}）的全部 API key 吗？吊销后立即失效、不可恢复，使用该 key 的集成将中断。`}
          </DialogDescription>
        </DialogHeader>

        {revokeAll.error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>吊销失败</AlertTitle>
            <AlertDescription>{revokeAll.error.message}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={revokeAll.isPending}>
              取消
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            disabled={revokeAll.isPending}
            onClick={() => user && revokeAll.mutate({ userId: user.id })}
          >
            {revokeAll.isPending && <Spinner data-icon="inline-start" />}
            {revokeAll.isPending ? "吊销中…" : "确认吊销"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
