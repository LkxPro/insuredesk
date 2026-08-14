import { zodResolver } from "@hookform/resolvers/zod";
import { isTicketInFlight, type TicketEditData, type TicketEditInput } from "@insuredesk/shared";
import { AlertCircle, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { DiscardChangesDialog } from "@/components/DiscardChangesDialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/lib/toast";
import { trpc } from "@/lib/trpc";
import { AddCommentCard } from "./AddCommentCard";
import { AssignTicketDialog } from "./AssignTicketDialog";
import { DeleteTicketDialog } from "./DeleteTicketDialog";
import { DetailNavButtons } from "./DetailNavButtons";
import {
  type CrossPageDirection,
  type DetailNav,
  type DetailNavStep,
  detailNavStep,
  handleDetailArrowKey,
} from "./detail-navigation";
import { ResolveTicketDialog } from "./ResolveTicketDialog";
import { StatusBadge } from "./StatusBadge";
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
import { TicketTimelineColumn } from "./TicketTimelineColumn";
import type { TicketDetail } from "./ticket-detail";

/**
 * 分栏详情区：头部（工单号 + 状态 + 四个操作）、左栏工单信息、右栏时间线与钉底
 * 跟进框。/tickets/:id 的选中态就是这块，不是弹窗 —— 二级弹窗（分配/完结/删除/
 * 丢弃确认）叠在它之上，处理现场（左侧窄列 + 本区）始终在背景里。
 *
 * 编辑是整单模式：点「编辑」后左栏可编辑字段原位变控件，一次「保存修改」＝一条
 * edit 留痕（投诉等级变更时服务端按新等级重算 dueAt 与跟进/首响要求）。取消与
 * 保存都回只读、不离开分栏。有未保存改动时三个出口——关闭详情、方向键/翻单按钮
 * 或点窄列切单、取消——都先过「丢弃修改？」。
 *
 * 右栏随模式自动切换：只读态显示时间线；编辑态下外部件（source=external_channel
 * 携带 submissionText）右栏自动切为工单原文对照（客服一边看原文一边补全左栏
 * 表单），非外部件编辑态右栏保持时间线。
 */

/** 未保存改动被拦下时，确认后要继续做的事。 */
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
  /** 方向键与 prev/next 按钮共用的导航面。 */
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
  const paneRef = useRef<HTMLElement>(null);
  const [editing, setEditing] = useState(false);
  const [pendingExit, setPendingExit] = useState<PendingExit | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  /** 保存被 409 兜底拦下时的提交载荷；非空即显示查重确认框，「仍要保存」带 allowDuplicate 重发。 */
  const [duplicateConflict, setDuplicateConflict] = useState<{
    payload: TicketEditInput & { allowDuplicate?: boolean };
  } | null>(null);

  const detailQuery = trpc.ticket.detail.useQuery({ id: ticketId }, { enabled: !!ticketId });
  const ticket = detailQuery.data ?? null;

  const form = useForm<TicketFormValues>({
    resolver: zodResolver(ticketFormSchema),
    defaultValues: formDefaults(null),
  });

  // 编辑态即时查重：排除工单自身，命中提示贴身挂在保单号/手机号控件下
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
    // ↑/↓ 翻单靠 keydown 冒泡到本区，焦点留在窄列按钮上时事件到不了这里
    paneRef.current?.focus({ preventScroll: true });
  }, [ticketId]);

  const dirty = editing && form.formState.isDirty;

  /** 编辑态入口：用当前详情预填，而不是空白建单表单。 */
  function startEditing() {
    if (!ticket) return;
    form.reset(formDefaults(ticket));
    setEditing(true);
  }

  /** 出口统一入口：脏草稿先弹确认，干净则直接执行。 */
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

  /** 键盘与 prev/next 按钮同一入口：脏草稿先过「丢弃修改？」。 */
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
    <section
      ref={paneRef}
      aria-label="工单详情"
      className="flex min-h-0 flex-1 flex-col outline-hidden"
      tabIndex={-1}
      onKeyDown={(event) => handleDetailArrowKey(event, nav, applyStep)}
    >
      <PaneHeader
        ticket={ticket}
        editing={editing}
        saving={edit.isPending}
        prevStep={detailNavStep("prev", nav)}
        nextStep={detailNavStep("next", nav)}
        onStep={applyStep}
        onClose={() => requestExit({ kind: "close" })}
        onEdit={startEditing}
        onCancelEdit={() => requestExit({ kind: "read" })}
        onSave={form.handleSubmit(save)}
        onAssign={() => setAssignOpen(true)}
        onResolve={() => setResolveOpen(true)}
        onDelete={() => setDeleteOpen(true)}
        can={{
          edit: hasPermission("ticket.edit"),
          assign: hasPermission("ticket.assign"),
          process: hasPermission("ticket.process"),
          delete: hasPermission("ticket.delete"),
        }}
      />
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
    </section>
  );
}

/** 头部：标识 + 状态 + 操作。编辑态换成取消/保存，其余操作退场避免歧义。 */
function PaneHeader({
  ticket,
  editing,
  saving,
  prevStep,
  nextStep,
  onStep,
  onClose,
  onEdit,
  onCancelEdit,
  onSave,
  onAssign,
  onResolve,
  onDelete,
  can,
}: {
  ticket: TicketDetail | null;
  editing: boolean;
  saving: boolean;
  prevStep: DetailNavStep | null;
  nextStep: DetailNavStep | null;
  onStep: (step: DetailNavStep) => void;
  onClose: () => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: () => void;
  onAssign: () => void;
  onResolve: () => void;
  onDelete: () => void;
  can: { edit: boolean; assign: boolean; process: boolean; delete: boolean };
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-3">
      <h2 className="m-0 text-lg font-semibold">{ticket?.workOrderNumber ?? "工单详情"}</h2>
      {ticket && <StatusBadge status={ticket.displayStatus} />}
      <div className="flex-1" />

      {ticket && editing && (
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCancelEdit}
            disabled={saving}
          >
            取消
          </Button>
          <Button type="button" size="sm" onClick={onSave} disabled={saving}>
            {saving && <Spinner data-icon="inline-start" />}
            {saving ? "保存中…" : "保存修改"}
          </Button>
        </>
      )}

      {ticket && !editing && (
        <>
          {can.edit && (
            <Button type="button" variant="outline" size="sm" onClick={onEdit}>
              编辑
            </Button>
          )}
          {can.assign && !ticket.assigneeId && (
            <Button type="button" variant="outline" size="sm" onClick={onAssign}>
              分配
            </Button>
          )}
          {can.assign && ticket.assigneeId && (
            <Button type="button" variant="outline" size="sm" onClick={onAssign}>
              改派
            </Button>
          )}
          {can.process && isTicketInFlight(ticket.status) && (
            <Button type="button" size="sm" onClick={onResolve}>
              完结工单
            </Button>
          )}
          {can.delete && (
            <Button type="button" variant="destructive" size="sm" onClick={onDelete}>
              删除
            </Button>
          )}
        </>
      )}

      <DetailNavButtons prevStep={prevStep} nextStep={nextStep} onStep={onStep} />
      <Button type="button" variant="ghost" size="icon" aria-label="关闭详情" onClick={onClose}>
        <X />
      </Button>
    </div>
  );
}
