import {
  PRIORITY_LABELS,
  PROCESS_LOG_ACTION_LABELS,
  TICKET_FIELDS,
  TICKET_SOURCE_LABELS,
} from "@insuredesk/shared";
import { AlertCircle, ArrowLeft, CheckCircle2, Pencil, Trash2, UserPlus } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link, useParams } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { formatDateTime } from "@/lib/datetime";
import { trpc } from "@/lib/trpc";
import { AddCommentCard } from "./AddCommentCard";
import { AssignTicketDialog } from "./AssignTicketDialog";
import { DeleteTicketDialog } from "./DeleteTicketDialog";
import { ResolveTicketDialog } from "./ResolveTicketDialog";
import { StatusBadge } from "./StatusBadge";
import { TicketEditDialog } from "./TicketEditDialog";

/**
 * 工单详情: every ticket field grouped by section, plus the ProcessLog
 * timeline. Lifecycle actions live with the detail — 分配/改派 and 完结工单
 * in the header (gated by ticket.assign / ticket.process; both hidden on the
 * completed 终态), 添加跟进 above the timeline (gated by ticket.process on an
 * assigned/processing ticket). 编辑 is available in ANY status including
 * 已完结, and 删除 is the double-confirmed danger action (gated by
 * ticket.edit / ticket.delete).
 */

/** One label/value cell of a detail section. */
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
      <div className="flex items-center gap-3">
        <Skeleton className="size-9 rounded-md" />
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
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

export function TicketDetail() {
  const { id } = useParams<{ id: string }>();
  const { hasPermission } = useAuth();
  const [assignOpen, setAssignOpen] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const detailQuery = trpc.ticket.detail.useQuery({ id: id ?? "" }, { enabled: Boolean(id) });

  if (detailQuery.isLoading) {
    return <DetailSkeleton />;
  }

  if (detailQuery.error || !detailQuery.data) {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4 pt-10">
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>无法打开工单</AlertTitle>
          <AlertDescription>
            {detailQuery.error?.message ?? "工单不存在或无权查看"}
          </AlertDescription>
        </Alert>
        <Button asChild variant="outline" className="self-start">
          <Link to="/tickets">
            <ArrowLeft data-icon="inline-start" />
            返回工单管理
          </Link>
        </Button>
      </div>
    );
  }

  const ticket = detailQuery.data;
  // Mirrors the API guard: 完结 is part of 处理工单, only from an in-flight state
  const canResolve =
    hasPermission("ticket.process") &&
    (ticket.status === "assigned" || ticket.status === "processing");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="icon" aria-label="返回工单管理">
          <Link to="/tickets">
            <ArrowLeft />
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">{ticket.workOrderNumber}</h1>
        <StatusBadge status={ticket.displayStatus} />
        {ticket.complaintLevel && <Badge variant="secondary">{ticket.complaintLevel}</Badge>}
        <div className="ml-auto flex items-center gap-2">
          {/* 编辑: any status, 已完结 included */}
          {hasPermission("ticket.edit") && (
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
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
      </div>

      <Section title="基本信息">
        <Item label="工单号">{ticket.workOrderNumber}</Item>
        <Item label="创建时间">{formatDateTime(ticket.createdAt)}</Item>
        <Item label="更新时间">{formatDateTime(ticket.updatedAt)}</Item>
        <Item label={TICKET_FIELDS.feedbackTime.label}>{formatDateTime(ticket.feedbackTime)}</Item>
        <Item label="工单来源">{TICKET_SOURCE_LABELS[ticket.source]}</Item>
        <Item label="创建人">{ticket.createdBy}</Item>
      </Section>

      <Section title="业务信息">
        <Item label={TICKET_FIELDS.channelId.label}>{ticket.channel?.name}</Item>
        <Item label={TICKET_FIELDS.project.label}>{ticket.project}</Item>
        <Item label={TICKET_FIELDS.brokerageEntity.label}>{ticket.brokerageEntity}</Item>
        <Item label={TICKET_FIELDS.paymentChannel.label}>{ticket.paymentChannel}</Item>
        <Item label={TICKET_FIELDS.internalOrderNumber.label}>{ticket.internalOrderNumber}</Item>
        <Item label={TICKET_FIELDS.policyNumber.label}>{ticket.policyNumber}</Item>
        <Item label={TICKET_FIELDS.userComplaintChannel.label}>{ticket.userComplaintChannel}</Item>
        <Item label={TICKET_FIELDS.complaintReceiveChannel.label}>
          {ticket.complaintReceiveChannel}
        </Item>
      </Section>

      <Section title="客户信息">
        <Item label={TICKET_FIELDS.customerName.label}>{ticket.customerName}</Item>
        <Item label={TICKET_FIELDS.phone.label}>{ticket.phone}</Item>
        <Item label={TICKET_FIELDS.contactPhone.overrides.detailLabel}>{ticket.contactPhone}</Item>
        <Item label={TICKET_FIELDS.nuclearBodyStatus.label}>{ticket.nuclearBodyStatus}</Item>
        <Item label={TICKET_FIELDS.hasContacted.label}>
          {TICKET_FIELDS.hasContacted.options.find((option) => option.value === ticket.hasContacted)
            ?.label ?? null}
        </Item>
        <Item label={TICKET_FIELDS.contactTime.label}>{formatDateTime(ticket.contactTime)}</Item>
        <Item label={TICKET_FIELDS.contactId.label}>{ticket.contactId}</Item>
        <div className="sm:col-span-3">
          <Item label={TICKET_FIELDS.customerRequest.label}>
            <span className="whitespace-pre-wrap">{ticket.customerRequest}</span>
          </Item>
        </div>
      </Section>

      <Section title="分类与等级">
        <Item label={TICKET_FIELDS.categoryId.label}>{ticket.category?.name}</Item>
        <Item label={TICKET_FIELDS.complaintLevel.label}>{ticket.complaintLevel}</Item>
        <Item label={TICKET_FIELDS.priority.label}>
          {ticket.priority ? PRIORITY_LABELS[ticket.priority] : null}
        </Item>
        <Item label="跟进频次要求">{ticket.followUpFrequency}</Item>
        <Item label="首响要求">{ticket.firstResponseRequirement}</Item>
      </Section>

      <Section title="处理状态">
        <Item label="工单状态">
          <StatusBadge status={ticket.displayStatus} />
        </Item>
        <Item label="责任人">{ticket.assigneeName}</Item>
        <Item label="分配时间">{formatDateTime(ticket.assignedAt)}</Item>
        <Item label="处理时限">
          {/* dueAt null means 特急 (不设时限) when a level exists, 未定级 otherwise */}
          {ticket.dueAt
            ? formatDateTime(ticket.dueAt)
            : ticket.complaintLevel
              ? "不设时限（特急）"
              : null}
        </Item>
        <Item label="下次联系时间">{formatDateTime(ticket.nextContactTime)}</Item>
        <Item label="联系次数">{ticket.contactCount}</Item>
        <div className="sm:col-span-3">
          <Item label="处理结果">{ticket.processingResult || null}</Item>
        </div>
      </Section>

      {(ticket.completionTime || ticket.completionStatus) && (
        <Section title="完结信息">
          <Item label="完结时间">{formatDateTime(ticket.completionTime)}</Item>
          <Item label={TICKET_FIELDS.completionStatusId.label}>{ticket.completionStatus}</Item>
        </Section>
      )}

      {hasPermission("ticket.process") &&
        (ticket.status === "assigned" || ticket.status === "processing") && (
          <AddCommentCard ticketId={ticket.id} />
        )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">处理记录</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="m-0 flex list-none flex-col p-0">
            {ticket.processLogs.map((log, index) => (
              <li key={log.id} className="relative flex gap-3 pb-6 last:pb-0">
                {index < ticket.processLogs.length - 1 && (
                  <span aria-hidden className="absolute left-[5px] top-4 h-full w-px bg-border" />
                )}
                <span className="mt-1.5 size-[11px] shrink-0 rounded-full border-2 border-primary bg-background" />
                <div className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-x-2 text-sm">
                    <span className="font-medium">{PROCESS_LOG_ACTION_LABELS[log.action]}</span>
                    {log.operatorName && (
                      <span className="text-muted-foreground">{log.operatorName}</span>
                    )}
                    <span className="text-xs text-muted-foreground">{formatDateTime(log.at)}</span>
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

      {canResolve && (
        <ResolveTicketDialog
          open={resolveOpen}
          onOpenChange={setResolveOpen}
          ticket={{ id: ticket.id, workOrderNumber: ticket.workOrderNumber }}
        />
      )}

      {hasPermission("ticket.edit") && (
        <TicketEditDialog open={editOpen} onOpenChange={setEditOpen} ticket={ticket} />
      )}

      {hasPermission("ticket.delete") && (
        <DeleteTicketDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          ticket={{ id: ticket.id, workOrderNumber: ticket.workOrderNumber }}
        />
      )}

      {hasPermission("ticket.assign") && (
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
    </div>
  );
}
