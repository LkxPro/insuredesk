import { zodResolver } from "@hookform/resolvers/zod";
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
import {
  buildTicketFormSchema,
  TicketFormFields,
  type TicketFormValues,
  ticketFormValuesToInput,
} from "./TicketFormFields";

/**
 * Blank defaults with feedbackTime prefilled to the current local minute —
 * built fresh on each open so a reopen refreshes 此刻, never restoring a
 * stale draft. 手工建单多在客户刚反馈后，默认当前时间省一步操作；清空按钮
 * 兜住"反馈时间未知"的少数场景，提交为 null。
 *
 * Every field is listed so isDirty compares against a complete baseline: a
 * pristine form (仅默认 feedbackTime) or one typed into and erased back is
 * not dirty, and closing it never asks 丢弃修改？.
 */
function createDefaults(): TicketFormValues {
  return {
    feedbackTime: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
    channelId: "",
    project: "",
    brokerageEntity: "",
    paymentChannel: "",
    internalOrderNumber: "",
    policyNumbers: "",
    userComplaintChannel: "",
    complaintReceiveChannel: "",
    customerName: "",
    phone: "",
    contactPhone: "",
    customerRequest: "",
    nuclearBodyStatus: "",
    hasContacted: null,
    contactTime: "",
    contactId: "",
    categoryId: "",
    complaintLevel: "",
    priority: "",
  };
}

/**
 * Manual ticket creation, presented as a modal dialog over 工单管理 rather
 * than a separate page. The field set and validation live in TicketFormFields;
 * this dialog owns the blank defaults and the ticket.create submit. Success
 * stays on the list (toast carries the 工单号; the caller highlights the new
 * row via onCreated) — the detail is one click away as a dialog. Any close
 * path (outside click, X, Esc, 取消) first asks 丢弃修改？ when the form has
 * been edited beyond the feedbackTime default.
 */
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

  const requiredFields = user?.requiredTicketFields ?? [];
  const schema = buildTicketFormSchema(requiredFields);

  const form = useForm<TicketFormValues>({
    resolver: zodResolver(schema),
    defaultValues: createDefaults(),
  });
  const { isDirty, isSubmitting } = form.formState;

  // /tickets and /tickets/new render this same page without remounting, so the
  // page-load defaultValues would keep a stale feedbackTime; resetting on open
  // both re-stamps 此刻 and drops any cancelled draft (草稿不保留).
  useEffect(() => {
    if (open) {
      form.reset(createDefaults());
    }
  }, [open, form]);

  const create = trpc.ticket.create.useMutation({
    onSuccess: (ticket) => {
      toast.success(`工单 ${ticket.workOrderNumber} 已创建`);
      utils.ticket.list.invalidate();
      onCreated?.(ticket);
      onOpenChange(false);
    },
  });

  const onSubmit = form.handleSubmit((values) => create.mutate(ticketFormValuesToInput(values)));

  const busy = isSubmitting || create.isPending;

  // Every close path (outside click, X, Esc, 取消) funnels through Radix's
  // onOpenChange; a dirty form diverts to the 丢弃修改？ confirmation.
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
        open={open}
        onOpenChange={(next) => {
          if (!next) requestClose();
        }}
      >
        <DialogContent className="flex max-h-[min(720px,90svh)] flex-col gap-0 p-0 sm:max-w-3xl">
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

      <DiscardChangesDialog
        open={confirmDiscardOpen}
        onOpenChange={setConfirmDiscardOpen}
        onDiscard={() => {
          setConfirmDiscardOpen(false);
          onOpenChange(false);
        }}
      />
    </>
  );
}
