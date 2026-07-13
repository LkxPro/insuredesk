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
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle } from "lucide-react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { TicketFormFields, type TicketFormValues, ticketFormSchema } from "./TicketFormFields";

/**
 * Manual ticket creation, presented as a modal dialog over 工单管理 rather
 * than a separate page. The field set and validation live in the shared
 * TicketFormFields (also serving 编辑工单); this dialog owns the blank
 * defaults and the ticket.create submit.
 */
export function TicketCreateDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();

  const form = useForm<TicketFormValues>({
    resolver: zodResolver(ticketFormSchema),
    // Everything optional: a fully blank dialog is submittable.
    defaultValues: { feedbackTime: "", hasContacted: null, priority: "" },
  });

  const create = trpc.ticket.create.useMutation({
    onSuccess: (ticket) => {
      toast.success(`工单 ${ticket.workOrderNumber} 已创建`);
      navigate(`/tickets/${ticket.id}`);
    },
  });

  const onSubmit = form.handleSubmit((values) =>
    create.mutate({
      ...values,
      // Local datetime string → absolute instant; unfilled stays null (未知)
      feedbackTime: values.feedbackTime ? new Date(values.feedbackTime).toISOString() : null,
    }),
  );

  const busy = form.formState.isSubmitting || create.isPending;

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent
        className="flex max-h-[min(720px,90svh)] flex-col gap-0 p-0 sm:max-w-3xl"
        // A long form: don't discard a draft on an accidental outside click.
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>新建工单</DialogTitle>
          <DialogDescription>
            工单号、处理时限与跟进要求由系统按投诉等级自动生成。
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
            <TicketFormFields form={form} />
          </div>

          <div className="flex flex-col gap-3 border-t px-6 py-4">
            {create.error && (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertTitle>创建失败</AlertTitle>
                <AlertDescription>{create.error.message}</AlertDescription>
              </Alert>
            )}
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={busy}>
                  取消
                </Button>
              </DialogClose>
              <Button type="submit" disabled={busy}>
                {create.isPending && <Spinner data-icon="inline-start" />}
                {create.isPending ? "创建中…" : "创建工单"}
              </Button>
            </DialogFooter>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
