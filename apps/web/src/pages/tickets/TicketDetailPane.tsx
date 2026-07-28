import { zodResolver } from "@hookform/resolvers/zod";
import { isTicketInFlight, type TicketEditData } from "@insuredesk/shared";
import { AlertCircle, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { DiscardChangesDialog } from "@/components/DiscardChangesDialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/contexts/AuthContext";
import { trpc } from "@/lib/trpc";
import { AssignTicketDialog } from "./AssignTicketDialog";
import { DeleteTicketDialog } from "./DeleteTicketDialog";
import { ResolveTicketDialog } from "./ResolveTicketDialog";
import { StatusBadge } from "./StatusBadge";
import { SubmissionTextPane } from "./SubmissionTextPane";
import { formDefaults } from "./TicketDetailFields";
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
 * 保存都回只读、不离开分栏。有未保存改动时三个出口——关闭详情、↑/↓ 或点窄列切
 * 单、取消——都先过「丢弃修改？」。
 *
 * 右栏随模式自动切换：只读态显示时间线；编辑态下外部件（source=external_channel
 * 携带 submissionText）右栏自动切为工单原文对照（客服一边看原文一边补全左栏
 * 表单），非外部件编辑态右栏保持时间线。
 */

/** 未保存改动被拦下时，确认后要继续做的事。 */
type PendingExit = { kind: "close" } | { kind: "switch"; ticketId: string } | { kind: "read" };

export function TicketDetailPane({
  ticketId,
  onClose,
  onSwitch,
  /** ↑/↓ 的目标，列表边缘为 null（无动作）。 */
  neighbors,
}: {
  ticketId: string;
  onClose: () => void;
  onSwitch: (ticketId: string) => void;
  neighbors: { prev: string | null; next: string | null };
}) {
  const { hasPermission } = useAuth();
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const [pendingExit, setPendingExit] = useState<PendingExit | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const detailQuery = trpc.ticket.detail.useQuery({ id: ticketId }, { enabled: !!ticketId });
  const ticket = detailQuery.data ?? null;

  const form = useForm<TicketFormValues>({
    resolver: zodResolver(ticketFormSchema),
    defaultValues: formDefaults(null),
  });

  const edit = trpc.ticket.edit.useMutation({
    onSuccess: (result) => {
      toast.success(`工单 ${result.workOrderNumber} 已更新`);
      setEditing(false);
      // 字段、SLA 派生与时间线都在服务端变，回读而非本地拼
      utils.ticket.detail.invalidate();
      utils.ticket.list.invalidate();
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
    }
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
      aria-label="工单详情"
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={(event) => {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        // 输入控件内的方向键归控件自己（光标移动、Select 选项浏览）
        const target = event.target as HTMLElement;
        if (target.closest("input, textarea, [role='combobox'], [role='listbox']")) return;
        const to = event.key === "ArrowUp" ? neighbors.prev : neighbors.next;
        if (!to) return; // 列表边缘：不翻页，不报错
        event.preventDefault();
        requestExit({ kind: "switch", ticketId: to });
      }}
    >
      <PaneHeader
        ticket={ticket}
        editing={editing}
        saving={edit.isPending}
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
          <div className="min-h-0 overflow-y-auto p-4 xl:border-r">
            {edit.error && (
              <Alert variant="destructive" className="mb-4">
                <AlertCircle />
                <AlertTitle>保存失败</AlertTitle>
                <AlertDescription>{edit.error.message}</AlertDescription>
              </Alert>
            )}
            <TicketInfoColumn ticket={ticket} editing={editing} form={form} />
          </div>
          {editing &&
          ticket.source === "external_channel" &&
          ticket.submissionText != null &&
          ticket.submissionText !== "" ? (
            <SubmissionTextPane text={ticket.submissionText} />
          ) : (
            <TicketTimelineColumn
              ticket={ticket}
              canComment={hasPermission("ticket.process") && isTicketInFlight(ticket.status)}
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
    </section>
  );
}

/** 头部：标识 + 状态 + 操作。编辑态换成取消/保存，其余操作退场避免歧义。 */
function PaneHeader({
  ticket,
  editing,
  saving,
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

      <Button type="button" variant="ghost" size="icon" aria-label="关闭详情" onClick={onClose}>
        <X />
      </Button>
    </div>
  );
}
