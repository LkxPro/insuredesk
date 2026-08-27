import { zodResolver } from "@hookform/resolvers/zod";
import {
  type EditComplaintInput,
  type EditRefundInput,
  isTicketInFlight,
  TicketKindKey,
} from "@insuredesk/shared";
import { AlertCircle, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { DiscardChangesDialog } from "@/components/DiscardChangesDialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/lib/toast";
import { trpc } from "@/lib/trpc";
import { DetailPaneShell } from "@/pages/ticket-surface/DetailPaneShell";
import type {
  CrossPageDirection,
  DetailNav,
  DetailNavStep,
} from "@/pages/ticket-surface/detail-navigation";
import { StatusBadge } from "@/pages/ticket-surface/StatusBadge";
import { TicketTimelineColumn } from "@/pages/ticket-surface/TicketTimelineColumn";
import { AddCommentCard } from "./AddCommentCard";
import { AssignTicketDialog } from "./AssignTicketDialog";
import { DeleteTicketDialog } from "./DeleteTicketDialog";
import { ResolveTicketDialog } from "./ResolveTicketDialog";
import { SubmissionTextPane } from "./SubmissionTextPane";
import { formDefaults, refundFormDefaults } from "./TicketDetailFields";
import {
  DuplicateConfirmDialog,
  DuplicateFieldHint,
  DuplicateTicketsBanner,
  useTicketDuplicates,
} from "./TicketDuplicates";
import {
  type RefundEditFormValues,
  refundEditFormSchema,
  type TicketFormValues,
  ticketFormSchema,
  ticketFormValuesToInput,
} from "./TicketFormFields";
import { TicketInfoColumn } from "./TicketInfoColumn";

type PendingExit =
  | { kind: "close" }
  | { kind: "switch"; ticketId: string }
  | { kind: "crossPage"; direction: CrossPageDirection }
  | { kind: "read" };

type DuplicateConflict =
  | { kind: "complaint"; payload: EditComplaintInput & { allowDuplicate?: boolean } }
  | { kind: "refund"; payload: EditRefundInput & { allowDuplicate?: boolean } };

export function TicketDetailPane({
  ticketId,
  onClose,
  onSwitch,
  onCrossPage,
  nav,
}: {
  ticketId: string;
  onClose: () => void;
  onSwitch: (ticketId: string) => void;
  onCrossPage: (direction: CrossPageDirection) => void;
  nav: DetailNav;
}) {
  const { hasPermission } = useAuth();
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const [pendingExit, setPendingExit] = useState<PendingExit | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [duplicateConflict, setDuplicateConflict] = useState<DuplicateConflict | null>(null);

  const detailQuery = trpc.ticket.detail.useQuery({ id: ticketId }, { enabled: !!ticketId });
  const ticket = detailQuery.data ?? null;
  const isRefund = ticket?.kindKey === TicketKindKey.RefundException;

  const form = useForm<TicketFormValues>({
    resolver: zodResolver(ticketFormSchema),
    defaultValues: formDefaults(null),
  });
  const refundForm = useForm<RefundEditFormValues>({
    resolver: zodResolver(refundEditFormSchema),
    defaultValues: refundFormDefaults(null),
  });

  const complaintDuplicates = useTicketDuplicates(form, {
    excludeTicketId: ticketId,
    enabled: editing && !isRefund,
  });
  const refundDuplicates = useTicketDuplicates(refundForm, {
    excludeTicketId: ticketId,
    enabled: editing && isRefund,
  });
  const duplicates = isRefund ? refundDuplicates : complaintDuplicates;

  // 字段、SLA 派生与时间线都在服务端变，回读而非本地拼
  function onEditSuccess(result: { workOrderNumber: string }) {
    toast.success(`工单 ${result.workOrderNumber} 已更新`);
    setEditing(false);
    setDuplicateConflict(null);
    utils.ticket.detail.invalidate();
    utils.ticket.list.invalidate();
  }

  const editComplaint = trpc.ticket.editComplaint.useMutation({
    onSuccess: onEditSuccess,
    onError: (error, variables) => {
      // 409 = 服务端兜底查重命中：拦下保存，弹阻断确认框；其余错误走顶部 Alert
      if (error.data?.code === "CONFLICT") {
        editComplaint.reset();
        setDuplicateConflict({ kind: "complaint", payload: variables });
      }
    },
  });
  const editRefund = trpc.ticket.editRefund.useMutation({
    onSuccess: onEditSuccess,
    onError: (error, variables) => {
      if (error.data?.code === "CONFLICT") {
        editRefund.reset();
        setDuplicateConflict({ kind: "refund", payload: variables });
      }
    },
  });
  const editPending = editComplaint.isPending || editRefund.isPending;
  const editError = editComplaint.error ?? editRefund.error;

  // 切单要落回只读：翻单是浏览动作，不该把上一单的编辑态带过去
  // biome-ignore lint/correctness/useExhaustiveDependencies: ticketId 是触发重置的信号，不在 effect 体内使用
  useEffect(() => {
    setEditing(false);
    setPendingExit(null);
  }, [ticketId]);

  const dirty = editing && (isRefund ? refundForm.formState.isDirty : form.formState.isDirty);

  function startEditing() {
    if (!ticket) return;
    if (ticket.kindKey === TicketKindKey.RefundException) {
      refundForm.reset(refundFormDefaults(ticket));
    } else {
      form.reset(formDefaults(ticket));
    }
    setEditing(true);
  }

  function requestExit(exit: PendingExit) {
    if (dirty) {
      setPendingExit(exit);
      return;
    }
    performExit(exit);
  }

  function performExit(exit: PendingExit) {
    setEditing(false);
    setPendingExit(null);
    if (exit.kind === "close") {
      onClose();
    } else if (exit.kind === "switch") {
      onSwitch(exit.ticketId);
    } else if (exit.kind === "crossPage") {
      onCrossPage(exit.direction);
    }
  }

  function applyStep(step: DetailNavStep) {
    requestExit(
      step.kind === "switch"
        ? { kind: "switch", ticketId: step.ticketId }
        : { kind: "crossPage", direction: step.direction },
    );
  }

  function guardEmptyDiff(isDirty: boolean): boolean {
    // 服务端也会把空 diff 判成无效编辑，这里省一次往返并说清楚
    if (isDirty) return false;
    toast.warning("未修改任何字段");
    setEditing(false);
    return true;
  }

  function saveComplaint(values: TicketFormValues) {
    if (!ticket || guardEmptyDiff(form.formState.isDirty)) return;
    editComplaint.mutate({ ticketId: ticket.id, ...ticketFormValuesToInput(values) });
  }

  function saveRefund(values: RefundEditFormValues) {
    if (!ticket || guardEmptyDiff(refundForm.formState.isDirty)) return;
    editRefund.mutate({
      ticketId: ticket.id,
      contactPhone: values.contactPhone,
      slaPolicyId: values.slaPolicyId,
    });
  }

  return (
    <DetailPaneShell
      focusKey={ticketId}
      nav={nav}
      onStep={applyStep}
      title={ticket?.workOrderNumber}
      status={ticket && <StatusBadge status={ticket.displayStatus} />}
      actions={
        ticket && (
          <>
            {editing && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => requestExit({ kind: "read" })}
                  disabled={editPending}
                >
                  取消
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={
                    isRefund
                      ? refundForm.handleSubmit(saveRefund)
                      : form.handleSubmit(saveComplaint)
                  }
                  disabled={editPending}
                >
                  {editPending && <Spinner data-icon="inline-start" />}
                  {editPending ? "保存中…" : "保存修改"}
                </Button>
              </>
            )}
            {!editing && (
              <>
                {hasPermission("ticket.edit") && (
                  <Button type="button" variant="outline" size="sm" onClick={startEditing}>
                    编辑
                  </Button>
                )}
                {hasPermission("ticket.assign") && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setAssignOpen(true)}
                  >
                    {ticket.assigneeId ? "改派" : "分配"}
                  </Button>
                )}
                {hasPermission("ticket.process") && isTicketInFlight(ticket.status) && (
                  <Button type="button" size="sm" onClick={() => setResolveOpen(true)}>
                    完结工单
                  </Button>
                )}
                {hasPermission("ticket.delete") && (
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => setDeleteOpen(true)}
                  >
                    删除
                  </Button>
                )}
              </>
            )}
          </>
        )
      }
      trailing={
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="关闭详情"
          onClick={() => requestExit({ kind: "close" })}
        >
          <X />
        </Button>
      }
    >
      {ticket && <DuplicateTicketsBanner ticket={ticket} />}

      {detailQuery.error ? (
        <Alert variant="destructive" className="m-4">
          <AlertCircle />
          <AlertTitle>工单加载失败</AlertTitle>
          <AlertDescription>{detailQuery.error.message}</AlertDescription>
        </Alert>
      ) : !ticket ? (
        <div className="flex flex-col gap-4 p-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="overflow-y-auto p-4 xl:min-h-0 xl:border-r">
            {editError && (
              <Alert variant="destructive" className="mb-4">
                <AlertCircle />
                <AlertTitle>保存失败</AlertTitle>
                <AlertDescription>{editError.message}</AlertDescription>
              </Alert>
            )}
            <TicketInfoColumn
              ticket={ticket}
              editing={editing}
              form={form}
              refundForm={refundForm}
              fieldAddon={(name) =>
                name === "policyNumbers" || name === "phone" || name === "contactPhone" ? (
                  <DuplicateFieldHint field={name} duplicates={duplicates} />
                ) : null
              }
            />
          </div>
          {editing &&
          ticket.source === "external_channel" &&
          ticket.submissionText != null &&
          ticket.submissionText !== "" ? (
            <SubmissionTextPane text={ticket.submissionText} />
          ) : (
            <TicketTimelineColumn
              logs={ticket.processLogs}
              completionStatus={ticket.completionStatus}
              composer={
                hasPermission("ticket.process") && isTicketInFlight(ticket.status) ? (
                  <AddCommentCard ticketId={ticket.id} />
                ) : undefined
              }
            />
          )}
        </div>
      )}

      {ticket && assignOpen && (
        <AssignTicketDialog
          mode="single"
          open
          onOpenChange={setAssignOpen}
          targets={[
            {
              id: ticket.id,
              workOrderNumber: ticket.workOrderNumber,
              assigneeId: ticket.assigneeId,
              assigneeName: ticket.assigneeName,
              dueAt: ticket.dueAt,
            },
          ]}
        />
      )}
      {ticket && resolveOpen && (
        <ResolveTicketDialog
          open={resolveOpen}
          onOpenChange={setResolveOpen}
          ticket={{ id: ticket.id, workOrderNumber: ticket.workOrderNumber }}
        />
      )}
      {ticket && deleteOpen && (
        <DeleteTicketDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          ticket={{ id: ticket.id, workOrderNumber: ticket.workOrderNumber }}
        />
      )}

      <DiscardChangesDialog
        open={pendingExit !== null}
        onOpenChange={(open) => !open && setPendingExit(null)}
        onDiscard={() => pendingExit && performExit(pendingExit)}
      />

      <DuplicateConfirmDialog
        values={
          duplicateConflict
            ? duplicateConflict.kind === "refund"
              ? {
                  policyNumbers: [],
                  phone: null,
                  contactPhone: duplicateConflict.payload.contactPhone ?? null,
                }
              : {
                  policyNumbers: duplicateConflict.payload.policyNumbers ?? [],
                  phone: duplicateConflict.payload.phone ?? null,
                  contactPhone: duplicateConflict.payload.contactPhone ?? null,
                }
            : null
        }
        excludeTicketId={ticketId}
        confirmLabel="仍要保存"
        confirming={editPending}
        onConfirm={() => {
          if (!duplicateConflict) return;
          if (duplicateConflict.kind === "refund") {
            editRefund.mutate({ ...duplicateConflict.payload, allowDuplicate: true });
          } else {
            editComplaint.mutate({ ...duplicateConflict.payload, allowDuplicate: true });
          }
        }}
        onCancel={() => setDuplicateConflict(null)}
      />
    </DetailPaneShell>
  );
}
