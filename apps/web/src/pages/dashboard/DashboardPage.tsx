import {
  DASHBOARD_METRIC_KEYS,
  DASHBOARD_METRIC_LABELS,
  type DashboardMetricKey,
} from "@insuredesk/shared";
import { AlertCircle, Users } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createdRangeLabel } from "@/lib/created-range";
import { formatDurationMs } from "@/lib/datetime";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { CreatedRangeFilter } from "@/pages/ticket-surface/CreatedRangeFilter";
import { buildChannelTicketListUrl, buildTicketListUrl } from "./build-ticket-list-url";
import { useCreatedRangeQueryParams } from "./useCreatedRangeQueryParams";

/**
 * 数据看板: 8 metric cards, the channel distribution, and the Top-10
 * 跟进人考核表 — one query, one screen. All 口径 live server-side
 * (dashboard.service.ts); this page renders the payload as-is. Data scope
 * is server-enforced too: without dashboard.view_all the numbers cover only
 * the viewer's own tickets, and the header says so.
 */

/** The two read-time overlay cards carry the alert palette. */
const METRIC_TONES: Partial<Record<DashboardMetricKey, string>> = {
  pendingTimeout: "text-amber-600 dark:text-amber-500",
  overdue: "text-destructive",
};

/** 口径 fine print for the cards whose number needs reading rules. */
const METRIC_HINTS: Partial<Record<DashboardMetricKey, string>> = {
  pendingTimeout: "距时限不足 2 小时",
  overdue: "在途已过时限，完结即移出",
};

function MetricCard({
  metric,
  value,
  href,
  label,
  hint,
}: {
  metric: DashboardMetricKey;
  value: number;
  href: string;
  label?: string;
  hint?: string;
}) {
  const finePrint = hint ?? METRIC_HINTS[metric];
  return (
    <Link to={href} className="block">
      <Card className="gap-2 py-4 transition-colors hover:bg-accent">
        <CardHeader className="px-4">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {label ?? DASHBOARD_METRIC_LABELS[metric]}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4">
          <div className={cn("text-3xl font-semibold tabular-nums", METRIC_TONES[metric])}>
            {value}
          </div>
          {finePrint && <p className="mt-1 text-xs text-muted-foreground">{finePrint}</p>}
        </CardContent>
      </Card>
    </Link>
  );
}

function MetricSkeletons() {
  return (
    <>
      {DASHBOARD_METRIC_KEYS.map((metric) => (
        <Card key={metric} className="gap-2 py-4">
          <CardHeader className="px-4">
            <Skeleton className="h-4 w-20" />
          </CardHeader>
          <CardContent className="px-4">
            <Skeleton className="h-8 w-16" />
          </CardContent>
        </Card>
      ))}
    </>
  );
}

const percentFormat = new Intl.NumberFormat("zh-CN", {
  style: "percent",
  maximumFractionDigits: 1,
});

export function DashboardPage() {
  const navigate = useNavigate();
  const [createdRange, setCreatedRange] = useCreatedRangeQueryParams();
  const statsQuery = trpc.dashboard.stats.useQuery(createdRange);
  const stats = statsQuery.data;
  const channelTotal = stats?.channels.reduce((sum, row) => sum + row.count, 0) ?? 0;
  const hasRange = createdRange.createdFrom !== undefined || createdRange.createdTo !== undefined;

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">数据看板</h1>
          <p className="text-sm text-muted-foreground">客诉工单运营全貌，一屏呈现。</p>
        </div>
        <div className="flex items-center gap-2">
          <CreatedRangeFilter range={createdRange} onChange={setCreatedRange} />
          {hasRange && (
            <Badge variant="outline" className="tabular-nums">
              {createdRangeLabel(createdRange)}
            </Badge>
          )}
          {stats?.scope === "own" && <Badge variant="secondary">仅统计我名下的工单</Badge>}
        </div>
      </div>

      {statsQuery.error ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>看板数据加载失败</AlertTitle>
          <AlertDescription>{statsQuery.error.message}</AlertDescription>
        </Alert>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            {stats ? (
              DASHBOARD_METRIC_KEYS.map((metric) => (
                <MetricCard
                  key={metric}
                  metric={metric}
                  value={stats.metrics[metric]}
                  label={
                    metric === "urgent" && stats.urgentPolicy ? stats.urgentPolicy.name : undefined
                  }
                  hint={
                    metric === "urgent"
                      ? stats.urgentPolicy
                        ? "最高档时效策略"
                        : "无启用的时效策略"
                      : undefined
                  }
                  href={buildTicketListUrl(metric, createdRange, stats.urgentPolicy?.id ?? null)}
                />
              ))
            ) : (
              <MetricSkeletons />
            )}
          </div>

          <div className="grid items-start gap-6 lg:grid-cols-[2fr_3fr]">
            <Card>
              <CardHeader>
                <CardTitle>渠道统计</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>渠道</TableHead>
                      <TableHead className="text-right">工单数</TableHead>
                      <TableHead className="text-right">占比</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stats
                      ? stats.channels.map((row) => (
                          <TableRow
                            key={row.channelId}
                            className="cursor-pointer"
                            onClick={() =>
                              navigate(buildChannelTicketListUrl(row.channelId, createdRange))
                            }
                          >
                            <TableCell>{row.name}</TableCell>
                            <TableCell className="text-right tabular-nums">{row.count}</TableCell>
                            <TableCell className="text-right tabular-nums">
                              {channelTotal === 0
                                ? "—"
                                : percentFormat.format(row.count / channelTotal)}
                            </TableCell>
                          </TableRow>
                        ))
                      : [0, 1, 2, 3].map((row) => (
                          <TableRow key={row}>
                            {[0, 1, 2].map((cell) => (
                              <TableCell key={cell}>
                                <Skeleton className="h-4 w-full max-w-16" />
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>跟进人考核 Top 10</CardTitle>
              </CardHeader>
              <CardContent>
                {stats && stats.assignees.length === 0 ? (
                  <Empty className="border-0">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <Users />
                      </EmptyMedia>
                      <EmptyTitle>暂无考核数据</EmptyTitle>
                      <EmptyDescription>工单分配给跟进人后，考核数据将在此呈现。</EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>跟进人</TableHead>
                        <TableHead className="text-right">完单数</TableHead>
                        <TableHead className="text-right">平均完结时长</TableHead>
                        <TableHead className="text-right">超时单数</TableHead>
                        <TableHead className="text-right">超时率</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stats
                        ? stats.assignees.map((row) => (
                            <TableRow key={row.assigneeId}>
                              <TableCell>{row.assigneeName}</TableCell>
                              <TableCell className="text-right tabular-nums">
                                {row.completedCount}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {formatDurationMs(row.avgCompletionMs)}
                              </TableCell>
                              <TableCell
                                className={cn(
                                  "text-right tabular-nums",
                                  row.overdueCount > 0 && "text-destructive",
                                )}
                              >
                                {row.overdueCount}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {percentFormat.format(row.overdueRate)}
                              </TableCell>
                            </TableRow>
                          ))
                        : [0, 1, 2, 3, 4].map((row) => (
                            <TableRow key={row}>
                              {[0, 1, 2, 3, 4].map((cell) => (
                                <TableCell key={cell}>
                                  <Skeleton className="h-4 w-full max-w-16" />
                                </TableCell>
                              ))}
                            </TableRow>
                          ))}
                    </TableBody>
                  </Table>
                )}
                <p className="mt-3 text-xs text-muted-foreground">
                  超时单数为历史追责口径：含超时完结与在途超时，与"已超时"卡的实时口径不同；超时率 =
                  超时单数 / 名下工单数。六张状态卡互斥，合计 = 工单总数。
                </p>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
