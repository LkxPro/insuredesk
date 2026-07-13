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
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { COMPLETION_STATUSES, type CompletionStatus } from "@insuredesk/shared";
import { AlertCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

/**
 * 完结工单 dialog: the mandatory completion reason — one of the 12 封闭枚举 —
 * plus the 完结备注. The caller gates the entry point on ticket.process and
 * an in-flight status; completionTime, the → completed transition and its
 * ProcessLog pair are derived server-side in ticket.resolve. completed is a
 * 终态, hence the warning copy.
 */
export function ResolveTicketDialog({
  open,
  onOpenChange,
  ticket,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticket: { id: string; workOrderNumber: string };
}) {
  const utils = trpc.useUtils();
  const [completionStatus, setCompletionStatus] = useState<CompletionStatus | "">("");
  const [remark, setRemark] = useState("");

  // A fresh dialog starts blank — a terminal action must never be one click
  // away from confirming with a leftover pick.
  useEffect(() => {
    if (open) {
      setCompletionStatus("");
      setRemark("");
    }
  }, [open]);

  const resolve = trpc.ticket.resolve.useMutation({
    onSuccess: (result) => {
      toast.success(`工单 ${result.workOrderNumber} 已完结（${result.completionStatus}）`);
      // Status, 完结信息 and the timeline all change server-side
      utils.ticket.detail.invalidate();
      utils.ticket.list.invalidate();
      onOpenChange(false);
    },
  });

  function confirm() {
    if (!completionStatus || !remark.trim()) {
      return;
    }
    resolve.mutate({ ticketId: ticket.id, completionStatus, remark });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !resolve.isPending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>完结工单</DialogTitle>
          <DialogDescription>
            工单 {ticket.workOrderNumber}。完结后进入终态：不可重开，也不能再添加跟进。
          </DialogDescription>
        </DialogHeader>

        <Field>
          <FieldLabel htmlFor="completion-status">完结状态</FieldLabel>
          <Select
            value={completionStatus}
            onValueChange={(value) => setCompletionStatus(value as CompletionStatus)}
          >
            <SelectTrigger id="completion-status" className="w-full">
              <SelectValue placeholder="请选择完结状态" />
            </SelectTrigger>
            <SelectContent>
              {COMPLETION_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabel htmlFor="completion-remark">完结备注</FieldLabel>
          <Textarea
            id="completion-remark"
            placeholder="记录完结原因与处理结论"
            value={remark}
            onChange={(event) => setRemark(event.target.value)}
            maxLength={2000}
            disabled={resolve.isPending}
          />
        </Field>

        {resolve.error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>完结失败</AlertTitle>
            <AlertDescription>{resolve.error.message}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={resolve.isPending}>
              取消
            </Button>
          </DialogClose>
          <Button
            type="button"
            onClick={confirm}
            disabled={resolve.isPending || !completionStatus || !remark.trim()}
          >
            {resolve.isPending && <Spinner data-icon="inline-start" />}
            {resolve.isPending ? "提交中…" : "确认完结"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
