import type { AppRouter } from "@insuredesk/api";
import { PROCESS_LOG_ACTION_LABELS, type ProcessLogAction } from "@insuredesk/shared";
import type { inferRouterOutputs } from "@trpc/server";
import { AlertCircle, ArrowLeft, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/datetime";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/pages/tickets/StatusBadge";
import { ExternalNoteCard } from "./ExternalNoteCard";
import {
  EXTERNAL_DETAIL_FIELD_ORDER,
  type ExternalTicket,
  externalFieldLabel,
  externalFieldValue,
} from "./external-ticket-fields";

/**
 * 右栏详情 = 对话模型：头部（工单号+状态）→ 处理记录时间线 → 留言框贴合成
 * 一条对话流；工单原文与字段卡默认折叠压在底部——原文是提交者自己贴的、
 * 字段是客服后补的元数据，都是"偶尔对照"而非每次必读。已完结是终态，
 * 只读（无留言框）。
 *
 * 时间线内容已由服务端过滤（create + comment 非 internal + external_note +
 * resolve），这里只按 action 区分样式。字段卡只渲染白名单内且有值的字段。
 */

/** 时间线圆点按 action 着色：外部留言是"我方发出"，与内部跟进一眼可分。 */
const TIMELINE_DOT_CLASSES: Partial<Record<ProcessLogAction, string>> = {
  external_note: "border-blue-500 bg-blue-500/20",
  resolve: "border-emerald-500 bg-emerald-500/20",
};

/** 详情响应整体：父组件查一次，头部与 DetailBody 共用（拒绝两处各自订阅）。 */
type DetailData = inferRouterOutputs<AppRouter>["externalTicket"]["detail"];

/** 折叠卡：标题行即开关，默认收起（打开状态由调用方持有）。 */
function CollapsibleCard({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex items-center gap-1.5 text-left"
        >
          {open ? (
            <ChevronDown className="size-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 text-muted-foreground" />
          )}
          <CardTitle className="text-base">{title}</CardTitle>
        </button>
      </CardHeader>
      {open && <CardContent>{children}</CardContent>}
    </Card>
  );
}

function FieldEntries({
  ticket,
  visibleFields,
}: {
  ticket: ExternalTicket;
  visibleFields: readonly string[];
}) {
  const shown = EXTERNAL_DETAIL_FIELD_ORDER.filter((key) => visibleFields.includes(key)).map(
    (key) => ({ key, value: externalFieldValue(ticket, key) }),
  );
  const filled = shown.filter((entry) => entry.value !== null && entry.value !== "");

  if (filled.length === 0) {
    return <p className="m-0 text-sm text-muted-foreground">客服团队还未补充工单信息。</p>;
  }
  return (
    <dl className="m-0 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {filled.map(({ key, value }) => (
        <div key={key} className="flex flex-col gap-0.5">
          <dt className="text-xs text-muted-foreground">{externalFieldLabel(key)}</dt>
          <dd className="m-0 text-sm">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** key={ticketId} 挂载，折叠态随换单重置——下一单从"对话流"开始读。 */
function DetailBody({
  ticketId,
  data,
  error,
}: {
  ticketId: string;
  data: DetailData | undefined;
  error: { message: string } | null;
}) {
  const [textOpen, setTextOpen] = useState(false);
  const [fieldsOpen, setFieldsOpen] = useState(false);

  if (error) {
    return (
      <div className="p-4">
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>工单加载失败</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const { ticket } = data;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex flex-col gap-4 p-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">处理记录</CardTitle>
          </CardHeader>
          <CardContent>
            {data.processLogs.length === 0 ? (
              <p className="m-0 text-sm text-muted-foreground">还没有处理记录。</p>
            ) : (
              <ol className="m-0 flex list-none flex-col p-0">
                {data.processLogs.map((log, index) => (
                  <li key={log.id} className="relative flex gap-3 pb-6 last:pb-0">
                    {index < data.processLogs.length - 1 && (
                      <span
                        aria-hidden
                        className="absolute left-[5px] top-4 h-full w-px bg-border"
                      />
                    )}
                    <span
                      className={cn(
                        "mt-1.5 size-[11px] shrink-0 rounded-full border-2 bg-background",
                        TIMELINE_DOT_CLASSES[log.action] ?? "border-primary",
                      )}
                    />
                    <div className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-x-2 text-sm">
                        {/* action 标签本身就是 外部留言/跟进记录，无需再挂徽标；
                            圆点颜色补足"谁发出的"这层区分 */}
                        <span className="font-medium">{PROCESS_LOG_ACTION_LABELS[log.action]}</span>
                        {log.operatorName && (
                          <span className="text-muted-foreground">{log.operatorName}</span>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {formatDateTime(log.createdAt)}
                        </span>
                      </div>
                      {log.remark && (
                        <p className="m-0 whitespace-pre-wrap text-sm text-muted-foreground">
                          {log.remark}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        {/* 已完结是终态，不再接受留言 */}
        {ticket.status !== "completed" && <ExternalNoteCard ticketId={ticketId} />}

        <CollapsibleCard title="工单原文" open={textOpen} onToggle={() => setTextOpen(!textOpen)}>
          <p className="m-0 whitespace-pre-wrap text-sm">{ticket.submissionText || "—"}</p>
        </CollapsibleCard>

        <CollapsibleCard
          title="工单信息"
          open={fieldsOpen}
          onToggle={() => setFieldsOpen(!fieldsOpen)}
        >
          <FieldEntries ticket={ticket} visibleFields={data.visibleFields} />
        </CollapsibleCard>
      </div>
    </div>
  );
}

export function ExternalTicketDetailPane({
  ticketId,
  onClose,
}: {
  ticketId: string;
  onClose: () => void;
}) {
  const detailQuery = trpc.externalTicket.detail.useQuery({ ticketId });
  const ticket = detailQuery.data?.ticket;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b px-4 py-3">
        {/* 窄屏主从不并存，返回键让位列表；宽屏它纯属多余 */}
        <Button
          variant="ghost"
          size="icon"
          className="size-7 lg:hidden"
          aria-label="返回列表"
          onClick={onClose}
        >
          <ArrowLeft />
        </Button>
        <h2 className="text-lg font-semibold tracking-tight">
          {ticket?.workOrderNumber ?? "工单详情"}
        </h2>
        {ticket && <StatusBadge status={ticket.status} />}
      </div>
      {/* key 强制换单重挂：折叠态与留言草稿不跨单残留 */}
      <DetailBody
        key={ticketId}
        ticketId={ticketId}
        data={detailQuery.data}
        error={detailQuery.error}
      />
    </div>
  );
}
