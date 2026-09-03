/**
 * PROTOTYPE — throwaway. V10-V12：V9 基线 + 四项修正（双极热力与占比切换、
 * 趋势跟随周期+自动粒度+环比虚线、考核表实时/周期分组、周期控件吸顶），
 * 三版对比：V10 基线修正（面积图+按列归一+双行表头+整行吸顶）/
 * V11 柱状趋势 + 全表归一热力 / V12 迷你胶囊吸顶 + 纯线趋势 + 徽标表头。
 */
import type { CreatedRangeQuery } from "@insuredesk/shared";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { presetToCreatedRange } from "@/lib/created-range";
import { CreatedRangeFilter } from "@/pages/ticket-surface/CreatedRangeFilter";
import { CompareLegend, CompareTrendChart, Donut, HBars, SourceBand } from "./charts";
import { CrossMatrixTable, type HeatScope, type MatrixMode } from "./cross-matrix";
import {
  buildCategoryRows,
  buildCrossMatrix,
  buildKindRows,
  buildSourceRows,
  POLICIES,
  scale30,
} from "./mock-analysis";
import { ACTION_METRICS, AGENTS } from "./mock-data";
import { PolicyCards } from "./policy-strip";
import { buildCompareTrend, GRANULARITY_LABELS } from "./trend-compare";
import { ActionCards, type AgentHeaderMode, AgentTable, SectionHeader } from "./widgets";

const DAY_MS = 86_400_000;

function periodDays(range: CreatedRangeQuery): number {
  if (range.createdFrom === undefined || range.createdTo === undefined) return 30;
  const ms = new Date(range.createdTo).getTime() - new Date(range.createdFrom).getTime();
  return Math.max(1, Math.round(ms / DAY_MS));
}

function usePeriod() {
  const [range, setRange] = useState<CreatedRangeQuery>(() => presetToCreatedRange("last30Days"));
  const days = periodDays(range);
  const trend = useMemo(() => buildCompareTrend(range), [range]);
  const crossMatrix = useMemo(() => buildCrossMatrix(days), [days]);
  const kindRows = useMemo(() => buildKindRows(days), [days]);
  const categoryRows = useMemo(() => buildCategoryRows(days), [days]);
  const sourceRows = useMemo(() => buildSourceRows(days), [days]);
  const agents = useMemo(
    () =>
      AGENTS.map((a) => {
        const completed = scale30(a.completed, days);
        const overdueCount = scale30(a.overdueCount, days);
        return {
          ...a,
          completed,
          overdueCount,
          overdueRate: completed === 0 ? 0 : overdueCount / completed,
        };
      }),
    [days],
  );
  return { range, setRange, days, trend, crossMatrix, kindRows, categoryRows, sourceRows, agents };
}

type Period = ReturnType<typeof usePeriod>;

function TitleRow({ variant }: { variant: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight">数据看板</h1>
      <p className="text-sm text-muted-foreground">原型 {variant} · mock 数据 · 下钻未实装</p>
    </div>
  );
}

function StickyPeriodBar({ period }: { period: Period }) {
  return (
    <div className="sticky top-0 z-20 -mx-4 flex items-center justify-end gap-2 border-b bg-background/90 px-4 py-2 backdrop-blur md:-mx-6 md:px-6">
      <span className="text-xs text-muted-foreground">统计周期（作用于趋势/分布/交叉/考核）</span>
      <CreatedRangeFilter range={period.range} onChange={period.setRange} />
      <Badge variant="secondary">行动区：当前快照</Badge>
    </div>
  );
}

function PeriodCapsule({ period }: { period: Period }) {
  return (
    <div className="pointer-events-none sticky top-2 z-20 flex justify-end">
      <div className="pointer-events-auto flex items-center gap-2 rounded-full border bg-background/95 px-3 py-1.5 shadow-sm backdrop-blur">
        <span className="text-xs text-muted-foreground">统计周期</span>
        <CreatedRangeFilter range={period.range} onChange={period.setRange} />
      </div>
    </div>
  );
}

const ACTION_NOTE =
  "已超时/即将超时含未分配单（未分配也在计时）；待首响仅计已分配。卡间有交集，勿加总。";

function ActionSection4() {
  return (
    <section className="flex flex-col gap-3">
      <SectionHeader title="需要行动" note="实时 · 30 秒自动刷新" />
      <ActionCards metrics={ACTION_METRICS} includeUrgent={false} />
      <p className="text-xs text-muted-foreground">{ACTION_NOTE}</p>
    </section>
  );
}

const MODE_LABELS: Array<{ value: MatrixMode; label: string }> = [
  { value: "value", label: "数值" },
  { value: "rowPct", label: "行占比" },
  { value: "colPct", label: "列占比" },
];

function MatrixSectionFinal({ period, heatScope }: { period: Period; heatScope: HeatScope }) {
  const [mode, setMode] = useState<MatrixMode>("value");
  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        title="渠道 × 用户反馈渠道交叉分析"
        note={`投诉单 · 统计周期内创建 · 热力蓝→红${heatScope === "table" ? "全表" : "按列"}归一`}
      />
      <Card>
        <CardHeader className="flex-row items-center justify-end">
          <ToggleGroup
            type="single"
            size="sm"
            value={mode}
            onValueChange={(v) => v && setMode(v as MatrixMode)}
          >
            {MODE_LABELS.map((m) => (
              <ToggleGroupItem key={m.value} value={m.value}>
                {m.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </CardHeader>
        <CardContent>
          <CrossMatrixTable
            rows={period.crossMatrix}
            heat="strong"
            heatScope={heatScope}
            mode={mode}
          />
          <p className="mt-3 text-xs text-muted-foreground">
            行 = 反馈渠道目录全量，列 = 用户反馈渠道目录全量，顺序跟随字典；悬浮单元格看
            数值/行占比/列占比三件套。监管/未填写行无实体可展；总计 = 周期内投诉单总数。
          </p>
        </CardContent>
      </Card>
    </section>
  );
}

function TrendSectionFinal({ period, mode }: { period: Period; mode: "area" | "bar" | "line" }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <SectionHeader
          title="单量趋势"
          note={`新增 · ${GRANULARITY_LABELS[period.trend.granularity]} · 跟随统计周期`}
        />
        <CompareLegend />
      </div>
      <Card>
        <CardContent className="pt-4">
          <CompareTrendChart points={period.trend.points} mode={mode} />
        </CardContent>
      </Card>
    </section>
  );
}

function DistTripleFixed({ period }: { period: Period }) {
  return (
    <section className="flex flex-col gap-3">
      <SectionHeader title="类型分布" note="统计周期内创建" />
      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle>工单种类（全部单）</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col justify-center">
            <Donut rows={period.kindRows} />
          </CardContent>
        </Card>
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle>客诉类别 Top 10（投诉单）</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 pt-2">
            <HBars rows={period.categoryRows} />
          </CardContent>
        </Card>
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle>来源构成（全部单）</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col justify-center">
            <SourceBand rows={period.sourceRows} />
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

function AgentSectionFinal({
  period,
  headerMode,
}: {
  period: Period;
  headerMode: AgentHeaderMode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <SectionHeader title="坐席负载与考核" note="负载为实时 · 考核为周期口径" />
      <Card>
        <CardContent className="pt-4">
          <AgentTable agents={period.agents} headerMode={headerMode} />
        </CardContent>
      </Card>
    </section>
  );
}

function PolicySection() {
  return (
    <section className="flex flex-col gap-3">
      <SectionHeader title="时效策略" note="各策略在途与超时 · 实时" />
      <PolicyCards policies={POLICIES} />
    </section>
  );
}

export function VariantV10() {
  const period = usePeriod();
  return (
    <div className="flex flex-1 flex-col gap-6 pb-24">
      <TitleRow variant="V10 基线修正" />
      <StickyPeriodBar period={period} />
      <ActionSection4 />
      <PolicySection />
      <MatrixSectionFinal period={period} heatScope="column" />
      <TrendSectionFinal period={period} mode="area" />
      <DistTripleFixed period={period} />
      <AgentSectionFinal period={period} headerMode="grouped" />
    </div>
  );
}

export function VariantV11() {
  const period = usePeriod();
  return (
    <div className="flex flex-1 flex-col gap-6 pb-24">
      <TitleRow variant="V11 柱状趋势 · 全表热力" />
      <StickyPeriodBar period={period} />
      <ActionSection4 />
      <PolicySection />
      <MatrixSectionFinal period={period} heatScope="table" />
      <TrendSectionFinal period={period} mode="bar" />
      <DistTripleFixed period={period} />
      <AgentSectionFinal period={period} headerMode="grouped" />
    </div>
  );
}

export function VariantV12() {
  const period = usePeriod();
  return (
    <div className="flex flex-1 flex-col gap-6 pb-24">
      <TitleRow variant="V12 胶囊吸顶 · 徽标表头" />
      <PeriodCapsule period={period} />
      <ActionSection4 />
      <PolicySection />
      <MatrixSectionFinal period={period} heatScope="column" />
      <TrendSectionFinal period={period} mode="line" />
      <DistTripleFixed period={period} />
      <AgentSectionFinal period={period} headerMode="badged" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* V13-V15：选定组合（胶囊吸顶 + 面积趋势 + 全表热力 + 双行表头），       */
/* 修「标题与周期控件不在同一行」的留白。三版 = 三种同行方案：            */
/* V13 吸顶标题带（标题+胶囊同行常驻）/ V14 视口 fixed 胶囊（零布局占位）/ */
/* V15 单行紧凑吸顶带。 */

function FinalBody({ period }: { period: Period }) {
  return (
    <>
      <ActionSection4 />
      <PolicySection />
      <MatrixSectionFinal period={period} heatScope="table" />
      <TrendSectionFinal period={period} mode="area" />
      <DistTripleFixed period={period} />
      <AgentSectionFinal period={period} headerMode="grouped" />
    </>
  );
}

function StickyTitleBar({ variant, period }: { variant: string; period: Period }) {
  return (
    <div className="sticky top-0 z-20 -mx-4 flex flex-wrap items-center justify-between gap-2 border-b bg-background/90 px-4 py-2.5 backdrop-blur md:-mx-6 md:px-6">
      <div className="flex items-baseline gap-2">
        <h1 className="text-xl font-semibold tracking-tight">数据看板</h1>
        <span className="text-xs text-muted-foreground">原型 {variant} · mock 数据</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="hidden text-xs text-muted-foreground sm:inline">统计周期</span>
        <CreatedRangeFilter range={period.range} onChange={period.setRange} />
        <Badge variant="secondary">行动区：当前快照</Badge>
      </div>
    </div>
  );
}

function CompactTitleBar({ variant, period }: { variant: string; period: Period }) {
  return (
    <div className="sticky top-0 z-20 -mx-4 flex h-12 items-center justify-between gap-2 border-b bg-background/90 px-4 backdrop-blur md:-mx-6 md:px-6">
      <div className="flex items-baseline gap-2">
        <h1 className="text-base font-semibold tracking-tight">数据看板</h1>
        <span className="text-xs text-muted-foreground">{variant} · mock</span>
      </div>
      <div className="flex items-center gap-2">
        <CreatedRangeFilter range={period.range} onChange={period.setRange} />
        <Badge variant="secondary" className="hidden md:inline-flex">
          行动区：当前快照
        </Badge>
      </div>
    </div>
  );
}

function FixedCapsule({ period }: { period: Period }) {
  return (
    <div className="fixed right-4 top-16 z-40 flex items-center gap-2 rounded-full border bg-background/95 px-3 py-1.5 shadow-sm backdrop-blur md:right-6">
      <span className="text-xs text-muted-foreground">统计周期</span>
      <CreatedRangeFilter range={period.range} onChange={period.setRange} />
    </div>
  );
}

export function VariantV13() {
  const period = usePeriod();
  return (
    <div className="flex flex-1 flex-col gap-6 pb-24">
      <StickyTitleBar variant="V13" period={period} />
      <FinalBody period={period} />
    </div>
  );
}

export function VariantV14() {
  const period = usePeriod();
  return (
    <div className="flex flex-1 flex-col gap-6 pb-24">
      <TitleRow variant="V14 fixed 胶囊" />
      <FixedCapsule period={period} />
      <FinalBody period={period} />
    </div>
  );
}

export function VariantV15() {
  const period = usePeriod();
  return (
    <div className="flex flex-1 flex-col gap-6 pb-24">
      <CompactTitleBar variant="V15" period={period} />
      <FinalBody period={period} />
    </div>
  );
}
