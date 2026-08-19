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
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/lib/toast";
import { trpc } from "@/lib/trpc";
import { SearchableCombobox } from "./SearchableCombobox";

/**
 * 分配 / 改派 / 批量分配 dialog. mode="single" drives ticket.assign,
 * mode="batch" drives ticket.batchAssign — the caller gates each entry point
 * on the matching permission. The dialog only picks WHO — status, assignedAt
 * and the ProcessLog trail are derived server-side, and dueAt never changes;
 * for a reassignment the remaining time is shown so a supervisor sees what
 * the new assignee inherits.
 */

export type AssignTarget = {
  id: string;
  workOrderNumber: string;
  assigneeId: string | null;
  assigneeName: string | null;
  dueAt: string | null;
};

function remainingTimeHint(dueAt: string | null): string {
  if (!dueAt) {
    return "不设时限";
  }
  const minutes = Math.round((new Date(dueAt).getTime() - Date.now()) / 60_000);
  const hint = `${Math.floor(Math.abs(minutes) / 60)}小时${Math.abs(minutes) % 60}分`;
  return minutes < 0 ? `已超时 ${hint}` : `剩余 ${hint}`;
}

export function AssignTicketDialog({
  mode,
  open,
  onOpenChange,
  targets,
  onAssigned,
}: {
  /** Which mutation backs the dialog — matches the permission gating the entry point. */
  mode: "single" | "batch";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targets: AssignTarget[];
  onAssigned?: () => void;
}) {
  const utils = trpc.useUtils();
  const [assigneeId, setAssigneeId] = useState("");

  useEffect(() => {
    if (open) {
      setAssigneeId("");
    }
  }, [open]);

  const options = trpc.ticket.assigneeOptions.useQuery(undefined, { enabled: open });

  const single = mode === "single" ? targets[0] : undefined;
  const isReassign = Boolean(single?.assigneeId);
  const reassignCount = single ? 0 : targets.filter((target) => target.assigneeId).length;
  const title = single ? (isReassign ? "改派工单" : "分配工单") : "批量分配";

  function settle(message: string) {
    toast.success(message);
    // The list row, the detail header, and the timeline all change server-side
    utils.ticket.list.invalidate();
    utils.ticket.detail.invalidate();
    onOpenChange(false);
    onAssigned?.();
  }

  const assign = trpc.ticket.assign.useMutation({
    onSuccess: (result) => {
      settle(
        `工单 ${result.workOrderNumber} 已${isReassign ? "改派" : "分配"}给 ${result.assigneeName}`,
      );
    },
  });
  const batchAssign = trpc.ticket.batchAssign.useMutation({
    onSuccess: (result) => {
      settle(
        result.skippedCount > 0
          ? `已将 ${result.assignedCount} 个工单分配给 ${result.assigneeName}（${result.skippedCount} 个已在其名下，未变动）`
          : `已将 ${result.assignedCount} 个工单分配给 ${result.assigneeName}`,
      );
    },
  });

  const busy = assign.isPending || batchAssign.isPending;
  const error = assign.error ?? batchAssign.error;

  function confirm() {
    if (!assigneeId) {
      return;
    }
    if (single) {
      assign.mutate({ ticketId: single.id, assigneeId });
    } else {
      batchAssign.mutate({ ticketIds: targets.map((target) => target.id), assigneeId });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {single
              ? `工单 ${single.workOrderNumber}`
              : `已选 ${targets.length} 个工单，统一分配给同一责任人。`}
          </DialogDescription>
        </DialogHeader>

        {single && isReassign && (
          <div className="rounded-md border bg-muted/50 px-3 py-2 text-sm">
            <p className="m-0">
              当前责任人：<span className="font-medium">{single.assigneeName}</span>
            </p>
            <p className="m-0 text-muted-foreground">
              处理时限不因改派顺延：{remainingTimeHint(single.dueAt)}
            </p>
          </div>
        )}

        {!single && reassignCount > 0 && (
          <div className="rounded-md border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
            其中 {reassignCount}{" "}
            个工单已有责任人，将被改派；处理时限不因改派顺延，已在所选责任人名下的将跳过。
          </div>
        )}

        <Field>
          <FieldLabel htmlFor="assignee">责任人</FieldLabel>
          <SearchableCombobox
            id="assignee"
            options={options.data ?? []}
            value={assigneeId}
            onChange={setAssigneeId}
            disabled={options.isLoading}
            autoFocus
            placeholder="输入姓名、拼音或首字母搜索"
            emptyText="无匹配的责任人"
            disabledReason={(option) =>
              // 改派场景置灰当前责任人——服务端会拒绝改派给同一人
              option.id === single?.assigneeId ? "当前责任人" : null
            }
          />
        </Field>

        {error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>
              {single ? (isReassign ? "改派失败" : "分配失败") : "批量分配失败"}
            </AlertTitle>
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={busy}>
              取消
            </Button>
          </DialogClose>
          <Button type="button" onClick={confirm} disabled={busy || !assigneeId}>
            {busy && <Spinner data-icon="inline-start" />}
            {busy ? "提交中…" : "确认"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
