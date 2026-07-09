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
import { useNavigate } from "react-router";
import { toast } from "sonner";

/**
 * 删除工单 double-confirmation (issue #28, PRD §4.5): ticket.delete is a
 * dangerous operation — the entry-point button only opens this dialog, and
 * only the explicit destructive confirm fires the mutation. The delete is
 * soft (deletedAt server-side) but this phase has no restore, so the copy
 * treats it as irreversible. Success leaves the now-invisible detail page
 * for the list.
 */
export function DeleteTicketDialog({
  open,
  onOpenChange,
  ticket,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticket: { id: string; workOrderNumber: string };
}) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const remove = trpc.ticket.delete.useMutation({
    onSuccess: (result) => {
      toast.success(`工单 ${result.workOrderNumber} 已删除`);
      utils.ticket.list.invalidate();
      navigate("/tickets");
    },
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !remove.isPending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>删除工单</DialogTitle>
          <DialogDescription>
            确定删除工单 {ticket.workOrderNumber}
            吗？删除后将从工单列表与所有统计中移除，且本期不提供恢复；处理记录会保留以供追溯。
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
            onClick={() => remove.mutate({ ticketId: ticket.id })}
            disabled={remove.isPending}
          >
            {remove.isPending && <Spinner data-icon="inline-start" />}
            {remove.isPending ? "删除中…" : "确认删除"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
