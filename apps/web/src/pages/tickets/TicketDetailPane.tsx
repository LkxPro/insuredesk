import { zodResolver } from "@hookform/resolvers/zod";
import { isTicketInFlight, type TicketEditData, type TicketEditInput } from "@insuredesk/shared";
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
import { formDefaults } from "./TicketDetailFields";
import {
  DuplicateConfirmDialog,
  DuplicateFieldHint,
  DuplicateTicketsBanner,
  useTicketDuplicates,
} from "./TicketDuplicates";
import {
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
  const [duplicateConflict, setDuplicateConflict] = useState<{
    payload: TicketEditInput & { allowDuplicate?: boolean };
  } | null>(null);

  const detailQuery = trpc.ticket.detail.useQuery({ id: ticketId }, { enabled: !!ticketId });
  const ticket = detailQuery.data ?? null;

  const form = useForm<TicketFormValues>({
    resolver: zodResolver(ticketFormSchema),
    defaultValues: formDefaults(null),
  });

  const duplicates = useTicketDuplicates(form, {
    excludeTicketId: ticketId,
    enabled: editing,
  });

  const edit = trpc.ticket.edit.useMutation({
    onSuccess: (result) => {
      toast.success(`工单 ${result.workOrderNumber} 已更新`);
      setEditing(false);
      setDuplicateConflict(null);
      // 字段、SLA 派生与时间线都在服务端变，回读而非本地拼
      utils.ticket.detail.invalidate();
      utils.ticket.list.invalidate();
    },
    onError: (error, variables) => {
      // 409 = 服务端兜底查重命中：拦下保存，弹阻断确认框；其余错误走顶部 Alert
      if (error.data?.code === "CONFLICT") {
        edit.reset();
        setDuplicateConflict({ payload: variables });
      }
    },
  });

  // 切单要落回只读：翻单是浏览动作，不该把上一单的编辑态带过去
  // biome-ignore lint/correctness/useExhaustiveDependencies: ticketId 是触发重置的信号，不在 effect 体内使用
  useEffect(() => {
    setEditing(false);
    setPendingExit(null);
  }, [ticketId]);

  const dirty = editing && form.formState.isDirty;

  function startEditing() {
    if (!ticket) return;
    form.reset(formDefaults(ticket));
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

  function save(values: TicketFormValues) {
    if (!ticket) return;
    if (!form.formState.isDirty) {
      // 服务端也会把空 diff 判成无效编辑，这里省一次往返并说清楚
      toast.warning("未修改任何字段");
      setEditing(false);
      return;
    }
    edit.mutate({ ticketId: ticket.id, ...ticketFormValuesToInput(values) } as TicketEditData);
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
                  disabled={edit.isPending}
                >
                  取消
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={form.handleSubmit(save)}
                  disabled={edit.isPending}
                >
                  {edit.isPending && <Spinner data-icon="inline-start" />}
                  {edit.isPending ? "保存中…" : "保存修改"}
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
            {edit.error && (
              <Alert variant="destructive" className="mb-4">
                <AlertCircle />
                <AlertTitle>保存失败</AlertTitle>
                <AlertDescription>{edit.error.message}</AlertDescription>
              </Alert>
            )}
            <TicketInfoColumn
              ticket={ticket}
              editing={editing}
              form={form}
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
            ? {
                policyNumbers: duplicateConflict.payload.policyNumbers ?? [],
                phone: duplicateConflict.payload.phone ?? null,
                contactPhone: duplicateConflict.payload.contactPhone ?? null,
              }
            : null
        }
        excludeTicketId={ticketId}
        confirmLabel="仍要保存"
        confirming={edit.isPending}
        onConfirm={() =>
          duplicateConflict && edit.mutate({ ...duplicateConflict.payload, allowDuplicate: true })
        }
        onCancel={() => setDuplicateConflict(null)}
      />
    </DetailPaneShell>
  );
}
