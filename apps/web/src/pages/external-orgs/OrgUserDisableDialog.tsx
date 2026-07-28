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
import type { OrgUserRow } from "./ExternalOrgDetailPage";

/**
 * 禁用机构账号 confirmation (external_org.manage): 与内部账号禁用同语义 —
 * locks out login AND kicks live sessions at once. 启用 is harmless and fires
 * directly from the table.
 */
export function OrgUserDisableDialog({
  user,
  onOpenChange,
}: {
  user: OrgUserRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();

  const disable = trpc.externalOrg.setUserActive.useMutation({
    onSuccess: (result) => {
      toast.success(`已禁用账号 ${result.name}`);
      utils.externalOrg.invalidate();
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={user !== null} onOpenChange={(next) => !disable.isPending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>禁用账号</DialogTitle>
          <DialogDescription>
            {user &&
              `确定禁用 ${user.name}（${user.username}）吗？禁用后无法登录，已登录的会话即刻失效；可随时重新启用。`}
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
