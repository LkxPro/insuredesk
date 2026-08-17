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

/**
 * 分栏详情区：头部操作、左栏工单信息、右栏时间线与钉底跟进框。/tickets/:id 的
 * 选中态就是这块，不是弹窗 —— 二级弹窗（分配/完结/删除/丢弃确认）叠在它之上，
 * 处理现场（左侧窄列 + 本区）始终在背景里。骨架（可聚焦 section、方向键翻单、
 * 头部行与 prev/next 按钮）由 DetailPaneShell 承载，本组件只留编辑状态机、
 * 头部操作槽与两栏正文。
 *
 * 编辑是整单模式：点「编辑」后左栏可编辑字段原位变控件，一次「保存修改」＝一条
 * edit 留痕（时效策略引用变更时服务端按新策略重算 dueAt 与跟进/首响要求）。取消与
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
            {/* 编辑态换成取消/保存，其余操作退场避免歧义 */}
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
