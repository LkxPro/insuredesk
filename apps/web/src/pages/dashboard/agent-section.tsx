import { Users } from "lucide-react";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
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
import { formatDurationMs } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import type { DashboardAnalysisStats } from "./dashboard-types";
import { SectionHeader } from "./section-header";

type Agents = DashboardAnalysisStats["agents"];

type AgentSort = "inFlight" | "completed";

const SORT_LABELS: Record<AgentSort, string> = {
  inFlight: "按在途",
  completed: "按完单",
};

export function AgentSection({ agents }: { agents: Agents }) {
  const [sort, setSort] = useState<AgentSort>("inFlight");
  const rows = [...agents].sort((a, b) => b[sort] - a[sort]);
  const num = (value: number, hot = false) =>
    cn(
      "text-right tabular-nums",
      hot && value > 0 ? "text-destructive" : value === 0 && "text-muted-foreground/50",
    );
  return (
    <section className="flex flex-col gap-3">
      <SectionHeader title="坐席负载与考核" note="负载为实时 · 考核为周期口径" />
      <Card>
        <CardContent className="pt-4">
          {agents.length === 0 ? (
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
            <>
              <div className="mb-3 flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">排序</span>
                {(Object.keys(SORT_LABELS) as AgentSort[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSort(key)}
                    className={cn(
                      "rounded-full border px-2.5 py-0.5 transition-colors",
                      sort === key
                        ? "border-foreground/30 bg-accent text-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    {SORT_LABELS[key]}
                  </button>
                ))}
              </div>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead />
                    <TableHead
                      colSpan={5}
                      className="border-b text-center text-xs font-normal text-muted-foreground"
                    >
                      实时
                    </TableHead>
                    <TableHead
                      colSpan={3}
                      className="border-b border-l text-center text-xs font-normal text-muted-foreground"
                    >
                      统计周期
                    </TableHead>
                  </TableRow>
                  <TableRow>
                    <TableHead>跟进人</TableHead>
                    <TableHead className="text-right">在途</TableHead>
                    <TableHead className="text-right">已超时</TableHead>
                    <TableHead className="text-right">即将超时</TableHead>
                    <TableHead className="text-right">待首响</TableHead>
                    <TableHead className="text-right">欠跟进</TableHead>
                    <TableHead className="border-l text-right">完单</TableHead>
                    <TableHead className="text-right">平均完结时长</TableHead>
                    <TableHead className="text-right">超时率</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const followUpDebt = row.followUpCheckpoints + row.followUpRolling;
                    return (
                      <TableRow key={row.assigneeId}>
                        <TableCell>{row.name}</TableCell>
                        <TableCell className={num(row.inFlight)}>{row.inFlight}</TableCell>
                        <TableCell className={num(row.overdue, true)}>{row.overdue}</TableCell>
                        <TableCell className={num(row.dueSoon)}>{row.dueSoon}</TableCell>
                        <TableCell className={num(row.awaitingFirstResponse)}>
                          {row.awaitingFirstResponse}
                        </TableCell>
                        <TableCell
                          className={num(followUpDebt)}
                          title={`节点提醒 ${row.followUpCheckpoints} · 滚动提醒 ${row.followUpRolling}`}
                        >
                          {followUpDebt}
                        </TableCell>
                        <TableCell className={cn(num(row.completed), "border-l")}>
                          {row.completed}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatDurationMs(row.avgCompletionMs)}
                        </TableCell>
                        <TableCell
                          className={num(row.overdueCount, true)}
                          title={`超时单数 ${row.overdueCount}（含超时完结与在途超时）`}
                        >
                          {(row.overdueRate * 100).toFixed(1)}%
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

export function AgentSectionSkeleton() {
  return (
    <section className="flex flex-col gap-3">
      <SectionHeader title="坐席负载与考核" note="负载为实时 · 考核为周期口径" />
      <Card>
        <CardContent className="flex flex-col gap-2 pt-4">
          {[0, 1, 2, 3].map((row) => (
            <Skeleton key={row} className="h-8 w-full" />
          ))}
        </CardContent>
      </Card>
    </section>
  );
}
