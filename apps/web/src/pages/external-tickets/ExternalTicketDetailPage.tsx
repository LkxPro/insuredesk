import { PROCESS_LOG_ACTION_LABELS, type ProcessLogAction } from "@insuredesk/shared";
import { AlertCircle, ArrowLeft } from "lucide-react";
import { Link, useParams } from "react-router";
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
 * 外部工单详情：字段卡片 + 时间线 + 留言框。
 *
 * 字段卡片按 TICKET_FIELDS 声明顺序遍历（不是白名单顺序——管理员配可见字段时
 * 不用关心顺序），只渲染白名单内且有值的字段：外部方看到的是"这单已知什么"，
 * 一片 — 只会稀释信息。时间线内容已由服务端过滤（comment 非 internal +
 * external_note + resolve），这里只负责按 action 区分样式。
 */

/** 时间线圆点按 action 着色：外部留言是"我方发出"，与内部跟进一眼可分。 */
const TIMELINE_DOT_CLASSES: Partial<Record<ProcessLogAction, string>> = {
  external_note: "border-blue-500 bg-blue-500/20",
  resolve: "border-emerald-500 bg-emerald-500/20",
};

function FieldCards({
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">工单信息</CardTitle>
      </CardHeader>
      <CardContent>
        {filled.length === 0 ? (
          <p className="m-0 text-sm text-muted-foreground">客服团队还未补充工单信息。</p>
        ) : (
          <dl className="m-0 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filled.map(({ key, value }) => (
              <div key={key} className="flex flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground">
                  {externalFieldLabel(key, "detailLabel")}
                </dt>
                <dd className="m-0 text-sm">{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

export function ExternalTicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const detailQuery = trpc.externalTicket.detail.useQuery(
    { ticketId: id ?? "" },
    { enabled: !!id },
  );

  const data = detailQuery.data;

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/external-tickets">
            <ArrowLeft data-icon="inline-start" />
            返回列表
          </Link>
        </Button>
        {data && (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">
              {data.ticket.workOrderNumber ?? "工单详情"}
            </h1>
            <StatusBadge status={data.ticket.status} />
          </>
        )}
      </div>

      {detailQuery.error ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>工单加载失败</AlertTitle>
          <AlertDescription>{detailQuery.error.message}</AlertDescription>
        </Alert>
      ) : !data ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">工单原文</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="m-0 whitespace-pre-wrap text-sm">{data.ticket.submissionText || "—"}</p>
            </CardContent>
          </Card>

          <FieldCards ticket={data.ticket} visibleFields={data.visibleFields} />

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
                          <span className="font-medium">
                            {PROCESS_LOG_ACTION_LABELS[log.action]}
                          </span>
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
          {data.ticket.status !== "completed" && id && <ExternalNoteCard ticketId={id} />}
        </>
      )}
    </div>
  );
}
