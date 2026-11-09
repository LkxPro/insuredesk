import { zodResolver } from "@hookform/resolvers/zod";
import type { TicketDuplicateMatchField, TicketRelatedMatch } from "@insuredesk/shared";
import { format } from "date-fns";
import { AlertCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { DiscardChangesDialog } from "@/components/DiscardChangesDialog";
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
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/lib/toast";
import { trpc } from "@/lib/trpc";
import { StatusBadge } from "@/pages/ticket-surface/StatusBadge";
import { TicketDetailPane } from "./TicketDetailPane";
import { useTicketMatchInput } from "./TicketDuplicates";
import {
  buildTicketFormSchema,
  TicketFormFields,
  type TicketFormValues,
  ticketFormValuesToInput,
} from "./TicketFormFields";

function createDefaults(): TicketFormValues {
  return {
    feedbackTime: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
    channelId: "",
    project: "",
    brokerageEntity: "",
    paymentChannel: "",
    internalOrderNumber: "",
    policyNumbers: "",
    noPolicyNumber: false,
    userFeedbackChannelId: "",
    feedbackReceiveChannelId: "",
    customerName: "",
    phone: "",
    contactPhone: "",
    customerRequest: "",
    nuclearBodyStatus: "",
    hasContacted: null,
    contactTime: "",
    contactId: "",
    categoryId: "",
    slaPolicyId: "",
    priority: "",
    address: null,
  };
}

export function TicketCreateDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (ticket: { id: string; workOrderNumber: string }) => void;
}) {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);
  const [relatedSelection, setRelatedSelection] = useState<{
    id: string;
    match: TicketRelatedMatch;
  } | null>(null);

  const requiredFields = user?.requiredTicketFields ?? [];
  const schema = buildTicketFormSchema(requiredFields);

  const form = useForm<TicketFormValues>({
    resolver: zodResolver(schema),
    defaultValues: createDefaults(),
  });
  const { isDirty, isSubmitting } = form.formState;
  const match = useTicketMatchInput(form);
  const queryable =
    match.policyNumbers.length > 0 || match.phone !== null || match.contactPhone !== null;
  const related = trpc.ticket.findRelated.useQuery(match, {
    enabled: open && queryable,
    retry: false,
  });
  const matches = queryable ? (related.data ?? []) : [];

  function fieldAddon(field: TicketDuplicateMatchField) {
    const hits = matches.filter((ticket) => ticket.matchedFields.includes(field));
    if (hits.length === 0) return null;
    return (
      <Alert>
        <AlertTitle>发现 {hits.length} 个关联工单，请追加备注</AlertTitle>
        <AlertDescription>
          <ul className="flex max-h-48 flex-col gap-2 overflow-y-auto">
            {hits.map((ticket) => (
              <li key={ticket.id} className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  onClick={() => setRelatedSelection({ id: ticket.id, match })}
                >
                  {ticket.workOrderNumber}
                </Button>
                <StatusBadge status={ticket.displayStatus} />
                <span>{ticket.customerName ?? "—"}</span>
              </li>
            ))}
          </ul>
        </AlertDescription>
      </Alert>
    );
  }

  // /tickets and /tickets/new render this same page without remounting, so the
  // page-load defaultValues would keep a stale feedbackTime; resetting on open
  // both re-stamps 此刻 and drops any cancelled draft (草稿不保留).
  useEffect(() => {
    if (open) {
      form.reset(createDefaults());
      setRelatedSelection(null);
    }
  }, [open, form]);

  const create = trpc.ticket.create.useMutation({
    onSuccess: (ticket) => {
      toast.success(`工单 ${ticket.workOrderNumber} 已创建`);
      utils.ticket.list.invalidate();
      onCreated?.(ticket);
      onOpenChange(false);
    },
    onError: (error) => {
      if (error.data?.code === "CONFLICT") {
        utils.ticket.findRelated.invalidate();
      }
    },
  });

  const onSubmit = form.handleSubmit((values) => create.mutate(ticketFormValuesToInput(values)));

  const busy = isSubmitting || create.isPending;

  const requestClose = () => {
    if (busy) return;
    if (isDirty) {
      setConfirmDiscardOpen(true);
    } else {
      onOpenChange(false);
    }
  };

  return (
    <>
      <Dialog
        open={open && !relatedSelection}
        onOpenChange={(next) => {
          if (!next) requestClose();
        }}
      >
        <DialogContent className="flex max-h-[min(720px,90svh)] flex-col gap-0 p-0 sm:max-w-3xl">
          <DialogHeader className="border-b px-6 py-4">
            <DialogTitle>新建工单</DialogTitle>
            <DialogDescription>
              工单号、处理时限与跟进要求由系统按时效策略自动生成。
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
            <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
              <TicketFormFields form={form} fieldAddon={fieldAddon} />
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
                <Button type="submit" disabled={busy || matches.length > 0}>
                  {create.isPending && <Spinner data-icon="inline-start" />}
                  {create.isPending ? "创建中…" : "创建工单"}
                </Button>
              </DialogFooter>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <DiscardChangesDialog
        open={confirmDiscardOpen}
        onOpenChange={setConfirmDiscardOpen}
        onDiscard={() => {
          setConfirmDiscardOpen(false);
          onOpenChange(false);
        }}
      />

      <Dialog
        open={open && !!relatedSelection}
        onOpenChange={(next) => {
          if (!next) setRelatedSelection(null);
        }}
      >
        <DialogContent
          className="flex h-[90svh] flex-col gap-0 p-0 sm:max-w-6xl"
          showCloseButton={false}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>关联工单详情</DialogTitle>
            <DialogDescription>查看已有工单并追加内部备注</DialogDescription>
          </DialogHeader>
          {relatedSelection && (
            <TicketDetailPane
              ticketId={relatedSelection.id}
              relatedMatch={relatedSelection.match}
              onClose={() => {
                setRelatedSelection(null);
                utils.ticket.findRelated.invalidate();
              }}
              onSwitch={() => {}}
              onCrossPage={() => {}}
              nav={{
                prev: null,
                next: null,
                inSlice: false,
                hasPrevPage: false,
                hasNextPage: false,
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
