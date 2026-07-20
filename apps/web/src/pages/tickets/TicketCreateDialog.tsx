import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { AlertCircle } from "lucide-react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router";
import { toast } from "sonner";
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
import { trpc } from "@/lib/trpc";
import {
  buildTicketFormSchema,
  localDateTimeToIso,
  TicketFormFields,
  type TicketFormValues,
} from "./TicketFormFields";

/**
 * Blank defaults with feedbackTime prefilled to the current local minute —
 * built fresh on each open so a reopen refreshes 此刻, never restoring a
 * stale draft. 手工建单多在客户刚反馈后，默认当前时间省一步操作；清空按钮
 * 兜住"反馈时间未知"的少数场景，提交为 null。
 */
function createDefaults(): TicketFormValues {
  return {
    feedbackTime: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
    contactTime: "",
    hasContacted: null,
    priority: "",
  };
}

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
  const { user } = useAuth();

  const requiredFields = user?.requiredTicketFields ?? [];
  const schema = buildTicketFormSchema(requiredFields);

  const form = useForm<TicketFormValues>({
    resolver: zodResolver(schema),
    defaultValues: createDefaults(),
  });

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
      navigate(`/tickets/${ticket.id}`);
    },
  });

  const onSubmit = form.handleSubmit((values) =>
    create.mutate({
      ...values,
      feedbackTime: localDateTimeToIso(values.feedbackTime),
      contactTime: localDateTimeToIso(values.contactTime),
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
