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
import type { Channel, ComplaintLevel, NuclearBodyStatus, Priority } from "@insuredesk/shared";
import { format } from "date-fns";
import { AlertCircle } from "lucide-react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import {
  type CurrentCategoryOption,
  TicketFormFields,
  type TicketFormValues,
  ticketFormSchema,
} from "./TicketFormFields";

/**
 * 编辑工单 dialog: the same basic-info field set as creation — shared
 * TicketFormFields — prefilled from the current detail, open in ANY status
 * (已完结 included). status is not a field here by design; the server
 * re-derives SLA fields on a complaintLevel change and writes the edit
 * ProcessLog, so success just invalidates the queries.
 */

/** The editable slice of the detail payload this dialog prefills from. */
export interface EditableTicket {
  id: string;
  workOrderNumber: string;
  feedbackTime: string | null;
  channel: Channel | null;
  project: string | null;
  brokerageEntity: string | null;
  paymentChannel: string | null;
  internalOrderNumber: string | null;
  policyNumber: string | null;
  userComplaintChannel: string | null;
  customerName: string | null;
  phone: string | null;
  contactPhone: string | null;
  customerRequest: string | null;
  nuclearBodyStatus: NuclearBodyStatus | null;
  hasContacted: boolean | null;
  contactId: string | null;
  category: CurrentCategoryOption | null;
  complaintLevel: ComplaintLevel | null;
  priority: Priority | null;
}

/** Detail wire values → form values: ISO instant to local partial, null to "". */
function formDefaults(ticket: EditableTicket): TicketFormValues {
  return {
    feedbackTime: ticket.feedbackTime
      ? format(new Date(ticket.feedbackTime), "yyyy-MM-dd'T'HH:mm")
      : "",
    channel: ticket.channel ?? "",
    project: ticket.project ?? "",
    brokerageEntity: ticket.brokerageEntity ?? "",
    paymentChannel: ticket.paymentChannel ?? "",
    internalOrderNumber: ticket.internalOrderNumber ?? "",
    policyNumber: ticket.policyNumber ?? "",
    userComplaintChannel: ticket.userComplaintChannel ?? "",
    customerName: ticket.customerName ?? "",
    phone: ticket.phone ?? "",
    contactPhone: ticket.contactPhone ?? "",
    customerRequest: ticket.customerRequest ?? "",
    nuclearBodyStatus: ticket.nuclearBodyStatus ?? "",
    hasContacted: ticket.hasContacted,
    contactId: ticket.contactId ?? "",
    categoryId: ticket.category?.id ?? "",
    complaintLevel: ticket.complaintLevel ?? "",
    priority: ticket.priority ?? "",
  };
}

export function TicketEditDialog({
  open,
  onOpenChange,
  ticket,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticket: EditableTicket;
}) {
  const utils = trpc.useUtils();

  const form = useForm<TicketFormValues>({
    resolver: zodResolver(ticketFormSchema),
    defaultValues: formDefaults(ticket),
  });

  // Re-open starts from the CURRENT detail, not a stale draft — the ticket may
  // have changed (another edit, a follow-up) since the dialog last closed.
  useEffect(() => {
    if (open) {
      form.reset(formDefaults(ticket));
    }
  }, [open, ticket, form]);

  const edit = trpc.ticket.edit.useMutation({
    onSuccess: (result) => {
      if (result.changedFields.length === 0) {
        toast.info("未修改任何字段");
      } else {
        toast.success(`工单 ${result.workOrderNumber} 已更新`);
      }
      // Fields, SLA derivations and the timeline all change server-side
      utils.ticket.detail.invalidate();
      utils.ticket.list.invalidate();
      onOpenChange(false);
    },
  });

  const onSubmit = form.handleSubmit((values) =>
    edit.mutate({
      ticketId: ticket.id,
      ...values,
      // Local datetime string → absolute instant; unfilled stays null (未知)
      feedbackTime: values.feedbackTime ? new Date(values.feedbackTime).toISOString() : null,
    }),
  );

  const busy = form.formState.isSubmitting || edit.isPending;

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent
        className="flex max-h-[min(720px,90svh)] flex-col gap-0 p-0 sm:max-w-3xl"
        // A long form: don't discard a draft on an accidental outside click.
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>编辑工单</DialogTitle>
          <DialogDescription>
            工单 {ticket.workOrderNumber}
            。改动会记录到处理记录；调整投诉等级将按新等级重算处理时限与跟进要求。
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
            <TicketFormFields form={form} currentCategory={ticket.category} />
          </div>

          <div className="flex flex-col gap-3 border-t px-6 py-4">
            {edit.error && (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertTitle>保存失败</AlertTitle>
                <AlertDescription>{edit.error.message}</AlertDescription>
              </Alert>
            )}
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={busy}>
                  取消
                </Button>
              </DialogClose>
              <Button type="submit" disabled={busy}>
                {edit.isPending && <Spinner data-icon="inline-start" />}
                {edit.isPending ? "保存中…" : "保存修改"}
              </Button>
            </DialogFooter>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
