import { AlertCircle, Info } from "lucide-react";
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
import type { AssignTarget } from "./AssignTicketDialog";

export function AutoAssignDialog({
  open,
  onOpenChange,
  targets,
  onAssigned,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targets: AssignTarget[];
  onAssigned?: (assignedTicketIds: string[]) => void;
}) {
  const utils = trpc.useUtils();
  const single = targets.length === 1 ? targets[0] : undefined;
  const autoAssign = trpc.ticket.autoAssign.useMutation({
    onSuccess: (result) => {
      if (result.assigned.length === 1) {
        const [entry] = result.assigned;
        toast.success(`工单 ${entry?.workOrderNumber} 已自动分配给 ${entry?.assigneeName}`);
      } else if (result.assigned.length > 1) {
        toast.success(`已按排班自动分配 ${result.assigned.length} 个工单`);
      }
      if (result.skipped.length > 0) {
        // 需要手动跟进，无留档，常驻到用户亲自关掉
        toast.warning(`当前无在岗人员，${result.skipped.length} 个工单未分配，请手动处理`, {
          duration: "sticky",
        });
      }
      utils.ticket.list.invalidate();
      utils.ticket.detail.invalidate();
      onOpenChange(false);
      onAssigned?.(result.assigned.map((entry) => entry.ticketId));
    },
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !autoAssign.isPending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>按排班自动分配</DialogTitle>
          <DialogDescription>
            {single ? `工单 ${single.workOrderNumber}` : `已选 ${targets.length} 个未分配工单。`}
          </DialogDescription>
        </DialogHeader>

        <Alert>
          <Info />
          <AlertTitle>分配规则</AlertTitle>
          <AlertDescription>
            系统从当前所有在岗人员中选择在手工单最少者；平手时随机选择。当前无人值班的工单会保留为未分配。
          </AlertDescription>
        </Alert>

        {autoAssign.error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>自动分配失败</AlertTitle>
            <AlertDescription>{autoAssign.error.message}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={autoAssign.isPending}>
              取消
            </Button>
          </DialogClose>
          <Button
            type="button"
            onClick={() => autoAssign.mutate({ ticketIds: targets.map((target) => target.id) })}
            disabled={autoAssign.isPending || targets.length === 0}
          >
            {autoAssign.isPending && <Spinner data-icon="inline-start" />}
            {autoAssign.isPending ? "分配中…" : "确认"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
