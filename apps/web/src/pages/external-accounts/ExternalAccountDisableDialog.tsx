import { AlertCircle } from "lucide-react";
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
import { Spinner } from "@/components/ui/spinner";
import { trpc } from "@/lib/trpc";
import type { ExternalAccountRow } from "./ExternalAccountManagePage";

/**
 * 禁用外部账号 confirmation (external_account.manage): 与内部账号禁用同语义 —
 * locks out login AND kicks live sessions at once. 启用 is harmless and fires
 * directly from the table.
 */
export function ExternalAccountDisableDialog({
  account,
  onOpenChange,
}: {
  account: ExternalAccountRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();

  const disable = trpc.externalAccount.setActive.useMutation({
    onSuccess: (result) => {
      toast.success(`已禁用账号 ${result.name}`);
      utils.externalAccount.invalidate();
      onOpenChange(false);
    },
  });

  return (
    <Dialog
      open={account !== null}
      onOpenChange={(next) => !disable.isPending && onOpenChange(next)}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>禁用账号</DialogTitle>
          <DialogDescription>
            {account &&
              `确定禁用 ${account.name}（${account.username}）吗？禁用后无法登录，已登录的会话即刻失效；可随时重新启用。`}
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
            onClick={() => account && disable.mutate({ id: account.id, active: false })}
          >
            {disable.isPending && <Spinner data-icon="inline-start" />}
            {disable.isPending ? "禁用中…" : "确认禁用"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
