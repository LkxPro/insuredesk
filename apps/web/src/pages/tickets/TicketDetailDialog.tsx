import { zodResolver } from "@hookform/resolvers/zod";
import {
  isTicketInFlight,
  PROCESS_LOG_ACTION_LABELS,
  TICKET_FIELDS,
  TICKET_SOURCE_LABELS,
  type TicketCreateFieldKey,
} from "@insuredesk/shared";
import { AlertCircle, CheckCircle2, Pencil, Trash2, UserPlus } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { DiscardChangesDialog } from "@/components/DiscardChangesDialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/contexts/AuthContext";
import { formatDateTime } from "@/lib/datetime";
import { trpc } from "@/lib/trpc";
import { AddCommentCard } from "./AddCommentCard";
import { AssignTicketDialog } from "./AssignTicketDialog";
import { DeleteTicketDialog } from "./DeleteTicketDialog";
import { ResolveTicketDialog } from "./ResolveTicketDialog";
import { StatusBadge } from "./StatusBadge";
import { formDefaults, TicketDetailField } from "./TicketDetailFields";
import {
  type TicketFormValues,
  ticketFormSchema,
  ticketFormValuesToInput,
} from "./TicketFormFields";

/**
 * 工单详情 as a modal over 工单管理, driven by the /tickets/:id route (same
 * pattern as /tickets/new → TicketCreateDialog), so a row click, a bell/todo
 * jump, a refresh or a new tab all land on the list with this dialog open.
 * Every ticket field grouped by section plus the ProcessLog timeline;
 * lifecycle actions in the header (分配/改派 and 完结工单 gated by
 * ticket.assign / ticket.process, hidden on the completed 终态), 添加跟进
 * above the timeline, 删除 as the double-confirmed danger action — and 编辑
 * in ANY status (已完结 included), which switches THIS dialog to edit mode
 * in place: editable fields become controls at their read-only positions
 * (TicketDetailField), system/SLA sections stay read-only, and 取消/保存 in
 * the footer returns to read-only without closing the dialog. Outside click,
 * X and Esc close the dialog in both modes; when the edit draft has changes,
 * any of those — and 取消 — first asks 丢弃修改？.
 *
 * QuickLook 键盘浏览: ↑/↓ swaps in the neighbouring ticket the caller derived
 * from its list (prev/nextTicketId; null means the edge — the key does
 * nothing). The swap goes through onNavigate so the URL moves with the
 * content, a dirty edit draft diverts to the same 丢弃修改？ first, and keys
 * pressed while a stacked dialog is open or while typing in a field are left
 * alone.
 */

/** One label/value cell of a detail section (系统/SLA 字段只读展示). */
function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="m-0 text-sm">{children ?? "—"}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-3">{children}</dl>
      </CardContent>
    </Card>
  );
}

/** Layout-shaped placeholder while the detail query is in flight. */
function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy>
      {[0, 1, 2].map((index) => (
        <Card key={index}>
          <CardHeader>
            <Skeleton className="h-5 w-24" />
          </CardHeader>
          <CardContent className="grid gap-x-6 gap-y-4 sm:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((cell) => (
              <div key={cell} className="flex flex-col gap-1.5">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-4 w-32" />
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/** Blank boot values; every edit session resets from the CURRENT detail. */
const EMPTY_FORM: TicketFormValues = {
  feedbackTime: "",
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

/** What a confirmed 丢弃修改？ proceeds to do. */
type DiscardAction = { kind: "close" } | { kind: "exitEdit" } | { kind: "navigate"; to: string };

export function TicketDetailDialog({
  open,
  onOpenChange,
  ticketId,
  prevTicketId,
  nextTicketId,
  onNavigate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticketId: string;
  prevTicketId: string | null;
  nextTicketId: string | null;
  onNavigate: (ticketId: string) => void;
}) {
  const { hasPermission } = useAuth();
  const utils = trpc.useUtils();
  const [assignOpen, setAssignOpen] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  // A dirty edit draft intercepts every way out — closing the dialog, 取消
  // back to read-only, an arrow-key jump — behind the same 丢弃修改？
  // confirmation.
  const [discardAction, setDiscardAction] = useState<DiscardAction | null>(null);
  const detailQuery = trpc.ticket.detail.useQuery({ id: ticketId }, { enabled: open });

  const form = useForm<TicketFormValues>({
    resolver: zodResolver(ticketFormSchema),
    defaultValues: EMPTY_FORM,
  });
  const { dirtyFields, errors, isSubmitting, isDirty } = form.formState;

  const edit = trpc.ticket.edit.useMutation({
    onSuccess: (result) => {
      if (result.changedFields.length === 0) {
        toast.info("未修改任何字段");
      } else {
        toast.success(`工单 ${result.workOrderNumber} 已更新`);
      }
      // Fields, SLA derivations and the timeline all change server-side
      utils.ticket.detail.invalidate();
      utils.ticket.list.invalidate();
      setEditing(false);
    },
  });

  const ticket = detailQuery.data;
  // Mirrors the API guard: 完结 is part of 处理工单, only from an in-flight state
  const canResolve =
    ticket !== undefined && hasPermission("ticket.process") && isTicketInFlight(ticket.status);
  const busy = isSubmitting || edit.isPending;

  // Entering edit mode starts from the CURRENT detail, not a stale draft —
  // the ticket may have changed (another edit, a follow-up) since last time.
  const startEditing = () => {
    if (!ticket) return;
    edit.reset();
    form.reset(formDefaults(ticket));
    setEditing(true);
  };
  const stopEditing = () => {
    edit.reset();
    form.reset(EMPTY_FORM);
    setEditing(false);
  };

  // Every dialog-close path (outside click, X, Esc) funnels through Radix's
  // onOpenChange; 取消 only exits edit mode. Either way a dirty draft diverts
  // to the 丢弃修改？ confirmation instead of acting immediately.
  const requestClose = () => {
    if (busy) return;
    if (editing && isDirty) {
      setDiscardAction({ kind: "close" });
    } else {
      onOpenChange(false);
    }
  };
  const requestStopEditing = () => {
    if (busy) return;
    if (isDirty) {
      setDiscardAction({ kind: "exitEdit" });
    } else {
      stopEditing();
    }
  };
  // Leaving for a neighbour always exits edit mode first: the dialog instance
  // survives the swap, so a draft (or the editing state itself) must never
  // carry over to the next ticket.
  const navigateTo = (id: string) => {
    stopEditing();
    onNavigate(id);
  };
  const confirmDiscard = () => {
    const action = discardAction;
    setDiscardAction(null);
    stopEditing();
    if (action?.kind === "close") {
      onOpenChange(false);
    } else if (action?.kind === "navigate") {
      onNavigate(action.to);
    }
  };

  // ↑/↓ live on document, not the dialog element: focus can land on body when
  // a header button unmounts (e.g. right after 编辑), and the keys should keep
  // working. Radix keeps stacked dialogs' focus in their own portals, so the
  // open-state gate — not bubbling — is what keeps them arrow-free.
  useEffect(() => {
    if (!open) return;
    const stackedDialogOpen = assignOpen || resolveOpen || deleteOpen || discardAction !== null;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      if (stackedDialogOpen || busy) return;
      // Typing surfaces keep their native arrow behaviour (text cursor,
      // select option hopping)
      if (
        event.target instanceof HTMLElement &&
        event.target.closest(
          "input, textarea, select, [contenteditable], [role='combobox'], [role='listbox']",
        )
      ) {
        return;
      }
      const to = event.key === "ArrowUp" ? prevTicketId : nextTicketId;
      if (to === null) return;
      event.preventDefault();
      if (editing && isDirty) {
        setDiscardAction({ kind: "navigate", to });
      } else {
        navigateTo(to);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  });

  const onSubmit = form.handleSubmit((values) => {
    if (!ticket) return;
    edit.mutate({ ticketId: ticket.id, ...ticketFormValuesToInput(values) });
  });

  const renderSections = (t: NonNullable<typeof ticket>) => {
    const field = (name: TicketCreateFieldKey) => (
      <TicketDetailField
        name={name}
        ticket={t}
        editing={editing}
        form={form}
        dirty={!!dirtyFields[name]}
        error={errors[name]?.message}
      />
    );
    return (
      <>
        <Section title="基本信息">
          <Item label="工单号">{t.workOrderNumber}</Item>
          <Item label="创建时间">{formatDateTime(t.createdAt)}</Item>
          <Item label="更新时间">{formatDateTime(t.updatedAt)}</Item>
          {field("feedbackTime")}
          <Item label="工单来源">{TICKET_SOURCE_LABELS[t.source]}</Item>
          <Item label="创建人">{t.createdBy}</Item>
        </Section>

        <Section title="业务信息">
          {field("channelId")}
          {field("project")}
          {field("brokerageEntity")}
          {field("paymentChannel")}
          {field("internalOrderNumber")}
          {field("policyNumbers")}
          {field("userComplaintChannel")}
          {field("complaintReceiveChannel")}
        </Section>

        <Section title="客户信息">
          {field("customerName")}
          {field("phone")}
          {field("contactPhone")}
          {field("nuclearBodyStatus")}
          {field("hasContacted")}
          {field("contactTime")}
          {field("contactId")}
          <div className="sm:col-span-3">{field("customerRequest")}</div>
          {t.submissionText != null && t.submissionText !== "" && (
            <div className="sm:col-span-3">
              <Item label="工单原文">
                <pre className="whitespace-pre-wrap text-sm">{t.submissionText}</pre>
              </Item>
            </div>
          )}
        </Section>

        <Section title="分类与等级">
          {field("categoryId")}
          {field("complaintLevel")}
          {field("priority")}
          <Item label="跟进频次要求">{t.followUpFrequency}</Item>
          <Item label="首响要求">{t.firstResponseRequirement}</Item>
        </Section>

        <Section title="处理状态">
          <Item label="工单状态">
            <StatusBadge status={t.displayStatus} />
          </Item>
          <Item label="责任人">{t.assigneeName}</Item>
          <Item label="分配时间">{formatDateTime(t.assignedAt)}</Item>
          <Item label="处理时限">
            {/* dueAt null means 特急 (不设时限) when a level exists, 未定级 otherwise */}
            {t.dueAt ? formatDateTime(t.dueAt) : t.complaintLevel ? "不设时限（特急）" : null}
          </Item>
          <Item label="下次联系时间">{formatDateTime(t.nextContactTime)}</Item>
          <Item label="联系次数">{t.contactCount}</Item>
          <div className="sm:col-span-3">
            <Item label="处理结果">{t.processingResult || null}</Item>
          </div>
        </Section>

        {(t.completionTime || t.completionStatus) && (
          <Section title="完结信息">
            <Item label="完结时间">{formatDateTime(t.completionTime)}</Item>
            <Item label={TICKET_FIELDS.completionStatusId.label}>{t.completionStatus}</Item>
          </Section>
        )}

        {!editing && hasPermission("ticket.process") && isTicketInFlight(t.status) && (
          <AddCommentCard ticketId={t.id} />
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">处理记录</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="m-0 flex list-none flex-col p-0">
              {t.processLogs.map((log, index) => (
                <li key={log.id} className="relative flex gap-3 pb-6 last:pb-0">
                  {index < t.processLogs.length - 1 && (
                    <span aria-hidden className="absolute left-[5px] top-4 h-full w-px bg-border" />
                  )}
                  <span className="mt-1.5 size-[11px] shrink-0 rounded-full border-2 border-primary bg-background" />
                  <div className="flex flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-x-2 text-sm">
                      <span className="font-medium">{PROCESS_LOG_ACTION_LABELS[log.action]}</span>
                      {log.operatorName && (
                        <span className="text-muted-foreground">{log.operatorName}</span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {formatDateTime(log.at)}
                      </span>
                    </div>
                    {log.from !== null && log.to !== null && (
                      <p className="m-0 text-xs text-muted-foreground">
                        {log.from} → {log.to}
                      </p>
                    )}
                    <p className="m-0 text-sm text-muted-foreground">{log.remark}</p>
                  </div>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </>
    );
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) requestClose();
        }}
      >
        <DialogContent className="flex max-h-[min(720px,90svh)] flex-col gap-0 p-0 sm:max-w-4xl">
          <DialogHeader className="border-b px-6 py-4">
            <div className="flex flex-wrap items-center gap-3 pr-6">
              <DialogTitle className="text-xl">{ticket?.workOrderNumber ?? "工单详情"}</DialogTitle>
              {ticket && <StatusBadge status={ticket.displayStatus} />}
              {ticket?.complaintLevel && <Badge variant="secondary">{ticket.complaintLevel}</Badge>}
              {ticket && !editing && (
                <div className="ml-auto flex items-center gap-2">
                  {/* 编辑: any status, 已完结 included */}
                  {hasPermission("ticket.edit") && (
                    <Button variant="outline" size="sm" onClick={startEditing}>
                      <Pencil data-icon="inline-start" />
                      编辑
                    </Button>
                  )}
                  {hasPermission("ticket.assign") && ticket.status !== "completed" && (
                    <Button variant="outline" size="sm" onClick={() => setAssignOpen(true)}>
                      <UserPlus data-icon="inline-start" />
                      {ticket.assigneeId ? "改派" : "分配"}
                    </Button>
                  )}
                  {canResolve && (
                    <Button size="sm" onClick={() => setResolveOpen(true)}>
                      <CheckCircle2 data-icon="inline-start" />
                      完结工单
                    </Button>
                  )}
                  {/* 删除: dangerous — the button only opens the 二次确认 dialog */}
                  {hasPermission("ticket.delete") && (
                    <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
                      <Trash2 data-icon="inline-start" />
                      删除
                    </Button>
                  )}
                </div>
              )}
            </div>
            <DialogDescription className="sr-only">
              {editing
                ? "编辑工单基本信息：改动会记录到处理记录，调整投诉等级将按新等级重算处理时限与跟进要求"
                : "工单只读详情与处理记录"}
            </DialogDescription>
          </DialogHeader>

          {detailQuery.isLoading ? (
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
              <DetailSkeleton />
            </div>
          ) : detailQuery.error || !ticket ? (
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
              <Alert variant="destructive">
                <AlertCircle />
                <AlertTitle>无法打开工单</AlertTitle>
                <AlertDescription>
                  {detailQuery.error?.message ?? "工单不存在或无权查看"}
                </AlertDescription>
              </Alert>
            </div>
          ) : editing ? (
            <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
              <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
                {renderSections(ticket)}
              </div>
              <div className="flex flex-col gap-3 border-t px-6 py-4">
                {edit.error && (
                  <Alert variant="destructive">
                    <AlertCircle />
                    <AlertTitle>保存失败</AlertTitle>
                    <AlertDescription>{edit.error.message}</AlertDescription>
                  </Alert>
                )}
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={requestStopEditing}
                  >
                    取消
                  </Button>
                  <Button type="submit" disabled={busy}>
                    {edit.isPending && <Spinner data-icon="inline-start" />}
                    {edit.isPending ? "保存中…" : "保存修改"}
                  </Button>
                </DialogFooter>
              </div>
            </form>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
              {renderSections(ticket)}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <DiscardChangesDialog
        open={discardAction !== null}
        onOpenChange={(next) => {
          if (!next) setDiscardAction(null);
        }}
        onDiscard={confirmDiscard}
      />

      {ticket && canResolve && (
        <ResolveTicketDialog
          open={resolveOpen}
          onOpenChange={setResolveOpen}
          ticket={{ id: ticket.id, workOrderNumber: ticket.workOrderNumber }}
        />
      )}

      {ticket && hasPermission("ticket.delete") && (
        <DeleteTicketDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          ticket={{ id: ticket.id, workOrderNumber: ticket.workOrderNumber }}
        />
      )}

      {ticket && hasPermission("ticket.assign") && (
        <AssignTicketDialog
          mode="single"
          open={assignOpen}
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
    </>
  );
}
