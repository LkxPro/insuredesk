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
import type { AssignTarget } from "./AssignTicketDialog";

/**
 * 按排班自动分配 confirm dialog (issue #31, PRD §4.3.4). Unlike the manual
 * dialog there is nothing to pick — the system chooses per ticket among the
 * channel's 当前在岗值班人, least 在手 first, ties at random — so this is a
 * confirm step that spells the algorithm out before firing. Tickets whose
 * channel has nobody on duty stay unassigned and come back as a per-channel
 * warning, telling the supervisor to assign those by hand (they also stay
 * selected, ready for a manual 批量分配).
 */
export function AutoAssignDialog({
  open,
  onOpenChange,
  targets,
  onAssigned,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targets: AssignTarget[];
  /** Called with the ids that WERE assigned — skipped tickets are not in it. */
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

      // PRD §4.3 边界: channels with nobody on duty are called out one by one
      const skippedByChannel = new Map<string, number>();
      for (const entry of result.skipped) {
        skippedByChannel.set(entry.channel, (skippedByChannel.get(entry.channel) ?? 0) + 1);
      }
      for (const [channel, count] of skippedByChannel) {
        toast.warning(`渠道「${channel}」当前无在岗值班人，${count} 个工单未分配，请手动分配`);
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

        <div className="rounded-md border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          系统将在各工单渠道的当前在岗值班人中，选择在手工单最少者（平手随机取一）。
          渠道当前无在岗值班人的工单不会被分配，需手动处理。
        </div>

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
