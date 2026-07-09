import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/datetime";
import { trpc } from "@/lib/trpc";
import {
  PRIORITY_LABELS,
  PROCESS_LOG_ACTION_LABELS,
  TICKET_SOURCE_LABELS,
  TICKET_STATUS_LABELS,
  type TicketDisplayStatus,
} from "@insuredesk/shared";
import { AlertCircle, ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router";

/**
 * 工单详情 (issue #22): every PRD §3.1 field grouped by its PRD section, plus
 * the ProcessLog timeline (§3.2). Pure read — lifecycle actions (assign,
 * comment, resolve…) arrive with their own tickets.
 */

/** Status color coding on the shared Badge; tints, not solid fills. */
const statusBadgeClasses: Record<TicketDisplayStatus, string> = {
  unassigned: "bg-muted text-muted-foreground",
  assigned: "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400",
  processing: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  completed: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  pending_timeout: "border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-400",
  overdue: "border-destructive/30 bg-destructive/10 text-destructive",
};

function StatusBadge({ status }: { status: TicketDisplayStatus }) {
  return (
    <Badge variant="outline" className={statusBadgeClasses[status]}>
      {TICKET_STATUS_LABELS[status]}
    </Badge>
  );
}

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
        <Badge variant="secondary">{ticket.complaintLevel}</Badge>
      </div>

      <Section title="基本信息">
        <Item label="工单号">{ticket.workOrderNumber}</Item>
        <Item label="创建时间">{formatDateTime(ticket.createdAt)}</Item>
        <Item label="更新时间">{formatDateTime(ticket.updatedAt)}</Item>
        <Item label="反馈时间">{formatDateTime(ticket.feedbackTime)}</Item>
        <Item label="工单来源">{TICKET_SOURCE_LABELS[ticket.source]}</Item>
        <Item label="创建人">{ticket.createdBy}</Item>
      </Section>

      <Section title="业务信息">
        <Item label="反馈渠道">{ticket.channel}</Item>
        <Item label="项目（保司）">{ticket.project}</Item>
        <Item label="经纪主体">{ticket.brokerageEntity}</Item>
        <Item label="支付渠道">{ticket.paymentChannel}</Item>
        <Item label="内部订单号">{ticket.internalOrderNumber}</Item>
        <Item label="保单号">{ticket.policyNumber}</Item>
        <Item label="用户投诉渠道">{ticket.userComplaintChannel}</Item>
      </Section>

      <Section title="客户信息">
        <Item label="客户姓名">{ticket.customerName}</Item>
        <Item label="客户电话（投保人）">{ticket.phone}</Item>
        <Item label="联系人电话（备用）">{ticket.contactPhone}</Item>
        <Item label="保司侧是否核身">{ticket.nuclearBodyStatus}</Item>
        <Item label="客户曾进线">{ticket.hasContacted ? "是" : "否"}</Item>
        <Item label="进线ID">{ticket.contactId}</Item>
        <div className="sm:col-span-3">
          <Item label="客户诉求">
            <span className="whitespace-pre-wrap">{ticket.customerRequest}</span>
          </Item>
        </div>
      </Section>

      <Section title="分类与等级">
        <Item label="客诉类别">{ticket.category}</Item>
        <Item label="投诉等级">{ticket.complaintLevel}</Item>
        <Item label="优先级">{ticket.priority ? PRIORITY_LABELS[ticket.priority] : null}</Item>
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
          {ticket.dueAt ? formatDateTime(ticket.dueAt) : "不设时限（特急）"}
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
          <Item label="完结状态">{ticket.completionStatus}</Item>
        </Section>
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
    </div>
  );
}
