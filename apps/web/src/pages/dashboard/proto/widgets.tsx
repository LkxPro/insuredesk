/**
 * PROTOTYPE — throwaway. 三变体共用的构件：行动卡组 / 考核合一表 / 区块头。
 * 染色规则 = 共识 Q16：数值 0 一律中性，>0 才上语义色。卡片全部不带导航
 * （下钻依赖列表新增 firstResponse/assigneeId 筛选，原型不实装）。
 */
import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { type ActionMetrics, type AgentRow, buildTrend } from "./mock-data";

interface ActionCardSpec {
  key: string;
  label: string;
  value: number;
  sub?: string;
  subTone?: "danger";
  tone: string;
}

function specsOf(m: ActionMetrics): ActionCardSpec[] {
  return [
    {
      key: "overdue",
      label: "已超时",
      value: m.overdue,
      sub: "在途已过处理时限",
      tone: "text-destructive",
    },
    {
      key: "dueSoon",
      label: "即将超时",
      value: m.dueSoon,
      sub: "距时限不足 2 小时",
      tone: "text-amber-600 dark:text-amber-500",
    },
    {
      key: "firstResponse",
      label: "待首响",
      value: m.awaitingFirstResponse,
      sub: m.firstResponseOverLine > 0 ? `${m.firstResponseOverLine} 单已过首响线` : "均无过线",
      subTone: m.firstResponseOverLine > 0 ? "danger" : undefined,
      tone: "text-amber-600 dark:text-amber-500",
    },
    {
      key: "unassigned",
      label: "未分配",
      value: m.unassigned,
      sub: `最老已等待 ${m.unassignedOldestWait}`,
      tone: "text-sky-600 dark:text-sky-500",
    },
    {
      key: "urgent",
      label: "特急在途",
      value: m.urgent,
      sub: "最高档时效策略",
      tone: "text-violet-600 dark:text-violet-400",
    },
  ];
}

export function ActionCards({
  metrics,
  dark = false,
  includeUrgent = true,
}: {
  metrics: ActionMetrics;
  dark?: boolean;
  includeUrgent?: boolean;
}) {
  const specs = includeUrgent
    ? specsOf(metrics)
    : specsOf(metrics).filter((card) => card.key !== "urgent");
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-3",
        includeUrgent ? "sm:grid-cols-3 xl:grid-cols-5" : "sm:grid-cols-4",
      )}
    >
      {specs.map((card) => {
        const hot = card.value > 0;
        return (
          <Card key={card.key} className={cn("gap-2 py-4", dark && "border-white/10 bg-white/5")}>
            <CardHeader className="px-4">
              <CardTitle
                className={cn(
                  "text-sm font-medium",
                  dark ? "text-white/60" : "text-muted-foreground",
                )}
              >
                {card.label}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4">
              <div
                className={cn(
                  "text-3xl font-semibold tabular-nums",
                  hot ? card.tone : dark ? "text-white/30" : "text-muted-foreground/50",
                )}
              >
                {card.value}
              </div>
              {card.sub && (
                <p
                  className={cn(
                    "mt-1 text-xs",
                    card.subTone === "danger" && hot
                      ? "text-destructive"
                      : dark
                        ? "text-white/40"
                        : "text-muted-foreground",
                  )}
                >
                  {card.sub}
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

type AgentSort = "inFlight" | "completed";

/** 考核表列口径：在途/超时/待首响/欠跟进 = 实时；完单/时长/超时率 = 统计周期。 */
export type AgentHeaderMode = "plain" | "grouped" | "badged";

const LIVE_SCOPE = "实时";
const PERIOD_SCOPE = "周期";

export function AgentTable({
  agents,
  dark = false,
  headerMode = "plain",
}: {
  agents: AgentRow[];
  dark?: boolean;
  headerMode?: AgentHeaderMode;
}) {
  const [sort, setSort] = useState<AgentSort>("inFlight");
  const rows = [...agents].sort((a, b) => b[sort] - a[sort]);
  const num = (v: number, hot = false) =>
    cn(
      "text-right tabular-nums",
      hot && v > 0
        ? "text-destructive"
        : v === 0
          ? dark
            ? "text-white/30"
            : "text-muted-foreground/50"
          : "",
    );
  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-xs">
        <span className={dark ? "text-white/50" : "text-muted-foreground"}>排序</span>
        {(["inFlight", "completed"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setSort(key)}
            className={cn(
              "rounded-full border px-2.5 py-0.5 transition-colors",
              sort === key
                ? dark
                  ? "border-white/40 bg-white/10 text-white"
                  : "border-foreground/30 bg-accent text-foreground"
                : dark
                  ? "border-white/15 text-white/50"
                  : "text-muted-foreground",
            )}
          >
            {key === "inFlight" ? "按在途" : "按完单"}
          </button>
        ))}
      </div>
      <Table>
        <TableHeader>
          {headerMode === "grouped" && (
            <TableRow
              className={dark ? "border-white/10 hover:bg-transparent" : "hover:bg-transparent"}
            >
              <TableHead className={dark ? "text-white/50" : ""} />
              <TableHead
                colSpan={5}
                className={cn(
                  "border-b text-center text-xs font-normal",
                  dark ? "text-white/40" : "text-muted-foreground",
                )}
              >
                实时
              </TableHead>
              <TableHead
                colSpan={3}
                className={cn(
                  "border-b border-l text-center text-xs font-normal",
                  dark ? "text-white/40" : "text-muted-foreground",
                )}
              >
                统计周期
              </TableHead>
            </TableRow>
          )}
          <TableRow className={dark ? "border-white/10 hover:bg-transparent" : ""}>
            {(
              [
                { label: "跟进人", left: true },
                { label: "在途", scope: LIVE_SCOPE },
                { label: "已超时", scope: LIVE_SCOPE },
                { label: "即将超时", scope: LIVE_SCOPE },
                { label: "待首响", scope: LIVE_SCOPE },
                { label: "欠跟进", scope: LIVE_SCOPE },
                { label: "完单", scope: PERIOD_SCOPE },
                { label: "平均完结时长", scope: PERIOD_SCOPE },
                { label: "超时率", scope: PERIOD_SCOPE },
              ] as const
            ).map((col) => (
              <TableHead
                key={col.label}
                className={cn(
                  !("left" in col && col.left) && "text-right",
                  dark && "text-white/50",
                )}
              >
                <div>{col.label}</div>
                {headerMode === "badged" && "scope" in col && (
                  <div className="text-[10px] font-normal text-muted-foreground">{col.scope}</div>
                )}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id} className={dark ? "border-white/10 hover:bg-white/5" : ""}>
              <TableCell className={dark ? "text-white/85" : ""}>{row.name}</TableCell>
              <TableCell className={num(row.inFlight)}>{row.inFlight}</TableCell>
              <TableCell className={num(row.overdue, true)}>{row.overdue}</TableCell>
              <TableCell className={num(row.dueSoon)}>{row.dueSoon}</TableCell>
              <TableCell className={num(row.awaitingFirstResponse)}>
                {row.awaitingFirstResponse}
              </TableCell>
              <TableCell className={num(row.followUpDebt)} title={row.followUpDebtDetail}>
                {row.followUpDebt}
              </TableCell>
              <TableCell className={num(row.completed)}>{row.completed}</TableCell>
              <TableCell className="text-right tabular-nums">{row.avgCompletion}</TableCell>
              <TableCell
                className={num(row.overdueCount, true)}
                title={`超时单数 ${row.overdueCount}（含超时完结与在途超时）`}
              >
                {(row.overdueRate * 100).toFixed(1)}%
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function SectionHeader({
  title,
  note,
  dark = false,
}: {
  title: string;
  note?: string;
  dark?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <h2 className={cn("text-lg font-semibold tracking-tight", dark && "text-white/90")}>
        {title}
      </h2>
      {note && (
        <span className={cn("text-xs", dark ? "text-white/40" : "text-muted-foreground")}>
          {note}
        </span>
      )}
    </div>
  );
}

export const TREND_WINDOWS = [7, 30, 90] as const;

export function useTrend() {
  const [days, setDays] = useState<(typeof TREND_WINDOWS)[number]>(30);
  const all = useMemo(() => buildTrend(90), []);
  return { days, setDays, data: all.slice(all.length - days) };
}

export function TrendWindowSwitch({
  days,
  setDays,
  dark = false,
}: {
  days: number;
  setDays: (d: (typeof TREND_WINDOWS)[number]) => void;
  dark?: boolean;
}) {
  return (
    <div className="flex items-center gap-1 text-xs">
      {TREND_WINDOWS.map((w) => (
        <button
          key={w}
          type="button"
          onClick={() => setDays(w)}
          className={cn(
            "rounded-full border px-2.5 py-0.5 tabular-nums transition-colors",
            days === w
              ? dark
                ? "border-white/40 bg-white/10 text-white"
                : "border-foreground/30 bg-accent text-foreground"
              : dark
                ? "border-white/15 text-white/50"
                : "text-muted-foreground",
          )}
        >
          {w} 天
        </button>
      ))}
    </div>
  );
}

export function TrendLegend({ dark = false }: { dark?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center gap-4 text-xs",
        dark ? "text-white/60" : "text-muted-foreground",
      )}
    >
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-full" style={{ backgroundColor: "var(--chart-3)" }} />
        新增
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-full" style={{ backgroundColor: "var(--chart-2)" }} />
        完结
      </span>
    </div>
  );
}
