import { TICKET_COMPLETION_REMARK_LIMIT, TICKET_FIELDS } from "@insuredesk/shared";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/lib/toast";
import { trpc } from "@/lib/trpc";

/**
 * 完结工单 dialog: the mandatory completion reason — a 完结状态目录 reference,
 * options from the catalog (启用项 only) — plus the 完结备注. The caller gates
 * the entry point on ticket.process and an in-flight status; completionTime,
 * the → completed transition and its ProcessLog pair are derived server-side
 * in ticket.resolve. completed is a 终态, hence the warning copy.
 */
/** What the dialog needs to know about the ticket it is completing. */
export type ResolveTarget = { id: string; workOrderNumber: string };

export function ResolveTicketDialog({
  open,
  onOpenChange,
  ticket,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticket: ResolveTarget;
}) {
  const utils = trpc.useUtils();
  const [completionStatusId, setCompletionStatusId] = useState("");
  const [remark, setRemark] = useState("");

  const options = trpc.completionStatus.options.useQuery(undefined, { enabled: open });

  // A fresh dialog starts blank — a terminal action must never be one click
  // away from confirming with a leftover pick.
  useEffect(() => {
    if (open) {
      setCompletionStatusId("");
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
    if (!completionStatusId || !remark.trim()) {
      return;
    }
    resolve.mutate({ ticketId: ticket.id, completionStatusId, remark });
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
          <FieldLabel htmlFor="completion-status">
            {TICKET_FIELDS.completionStatusId.label}
          </FieldLabel>
          <Select value={completionStatusId} onValueChange={setCompletionStatusId}>
            <SelectTrigger id="completion-status" className="w-full">
              <SelectValue placeholder="请选择完结状态" />
            </SelectTrigger>
            <SelectContent>
              {(options.data ?? []).map((status) => (
                <SelectItem key={status.id} value={status.id}>
                  {status.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabel htmlFor="completion-remark">
            {TICKET_FIELDS.completionRemark.label}
          </FieldLabel>
          <Textarea
            id="completion-remark"
            placeholder="记录完结原因与处理结论"
            value={remark}
            onChange={(event) => setRemark(event.target.value)}
            maxLength={TICKET_COMPLETION_REMARK_LIMIT}
            disabled={resolve.isPending}
          />
        </Field>

        {(resolve.error ?? options.error) && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>{options.error ? "完结状态加载失败" : "完结失败"}</AlertTitle>
            <AlertDescription>{(resolve.error ?? options.error)?.message}</AlertDescription>
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
            disabled={resolve.isPending || !completionStatusId || !remark.trim()}
          >
            {resolve.isPending && <Spinner data-icon="inline-start" />}
            {resolve.isPending ? "提交中…" : "确认完结"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
