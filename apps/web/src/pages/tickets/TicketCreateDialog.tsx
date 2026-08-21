import { zodResolver } from "@hookform/resolvers/zod";
import type { TicketCreateInput } from "@insuredesk/shared";
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
import { DuplicateConfirmDialog } from "./TicketDuplicates";
import {
  buildTicketFormSchema,
  TicketFormFields,
  type TicketFormValues,
  ticketFormValuesToInput,
} from "./TicketFormFields";

/**
 * 手工建单多在客户刚反馈后，默认 feedbackTime 为当前时间省一步操作；清空按钮
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
  const [duplicateConflict, setDuplicateConflict] = useState<{
    payload: TicketCreateInput & { allowDuplicate?: boolean };
  } | null>(null);

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
      setDuplicateConflict(null);
      onCreated?.(ticket);
      onOpenChange(false);
    },
    onError: (error, variables) => {
      // 409 = 服务端兜底查重命中：拦下创建，弹阻断确认框；其余错误走底部 Alert
      if (error.data?.code === "CONFLICT") {
        create.reset();
        setDuplicateConflict({ payload: variables });
      }
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
              工单号、处理时限与跟进要求由系统按时效策略自动生成。
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

      <DuplicateConfirmDialog
        values={
          duplicateConflict
            ? {
                policyNumbers: duplicateConflict.payload.policyNumbers ?? [],
                phone: duplicateConflict.payload.phone ?? null,
                contactPhone: duplicateConflict.payload.contactPhone ?? null,
              }
            : null
        }
        confirmLabel="仍要创建"
        confirming={create.isPending}
        onConfirm={() =>
          duplicateConflict && create.mutate({ ...duplicateConflict.payload, allowDuplicate: true })
        }
        onCancel={() => setDuplicateConflict(null)}
      />
    </>
  );
}
