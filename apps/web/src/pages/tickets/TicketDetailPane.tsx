import { zodResolver } from "@hookform/resolvers/zod";
import {
  type EditComplaintInput,
  type EditRefundInput,
  isTicketInFlight,
  TicketKindKey,
  type TicketRelatedMatch,
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
import { AddRelatedNoteCard } from "./AddRelatedNoteCard";
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
  addressFormValueToInput,
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
  relatedMatch,
}: {
  ticketId: string;
  onClose: () => void;
  onSwitch: (ticketId: string) => void;
  onCrossPage: (direction: CrossPageDirection) => void;
  nav: DetailNav;
  relatedMatch?: TicketRelatedMatch;
}) {
  const { hasPermission } = useAuth();
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const [pendingExit, setPendingExit] = useState<PendingExit | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [duplicateConflict, setDuplicateConflict] = useState<DuplicateConflict | null>(null);

  const ordinaryQuery = trpc.ticket.detail.useQuery(
    { id: ticketId },
    { enabled: !!ticketId && !relatedMatch },
  );
  const relatedQuery = trpc.ticket.relatedDetail.useQuery(
    { ticketId, match: relatedMatch ?? {} },
    { enabled: !!ticketId && !!relatedMatch, retry: false },
  );
  const detailQuery = relatedMatch ? relatedQuery : ordinaryQuery;
  const ticket = detailQuery.error ? null : (detailQuery.data ?? null);
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
    if (isDirty) return false;
    toast.warning("未修改任何字段");
    setEditing(false);
    return true;
  }

  function saveComplaint(values: TicketFormValues) {
    if (!ticket || guardEmptyDiff(form.formState.isDirty)) return;
    const { address, ...input } = ticketFormValuesToInput(values);
    editComplaint.mutate({
      ticketId: ticket.id,
      ...input,
      ...(form.formState.dirtyFields.address ? { address } : {}),
    });
  }

  function saveRefund(values: RefundEditFormValues) {
    if (!ticket || guardEmptyDiff(refundForm.formState.isDirty)) return;
    editRefund.mutate({
      ticketId: ticket.id,
      contactPhone: values.contactPhone,
      slaPolicyId: values.slaPolicyId,
      ...(refundForm.formState.dirtyFields.address
        ? { address: addressFormValueToInput(values.address) }
        : {}),
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
        ticket &&
        !relatedMatch && (
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
      {ticket && !relatedMatch && <DuplicateTicketsBanner ticket={ticket} />}

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
              readOnly={!!relatedMatch}
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
                relatedMatch ? (
                  <AddRelatedNoteCard key={ticket.id} ticketId={ticket.id} match={relatedMatch} />
                ) : hasPermission("ticket.process") && isTicketInFlight(ticket.status) ? (
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
          ticket={{ id: ticket.id, workOrderNumber: ticket.workOrderNumber, source: ticket.source }}
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
