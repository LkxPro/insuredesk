/**
 * PROTOTYPE — throwaway. V4/V5/V6：基于 V1（经典网格）的三版优化，共同增量 =
 * 可交互统计周期（含自定义范围，复用正式 CreatedRangeFilter）+ 全时效策略条 +
 * 渠道×主题交叉分析表（行展开下钻实体）。三版只差布局与策略条形态：
 * V4 保守加法 / V5 交叉表主角 / V6 双列密度。
 */
import type { CreatedRangeQuery } from "@insuredesk/shared";
import { type ReactNode, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createdRangeLabel, presetToCreatedRange } from "@/lib/created-range";
import { CreatedRangeFilter } from "@/pages/ticket-surface/CreatedRangeFilter";
import { Donut, HBars, SourceBand, TrendChart } from "./charts";
import { CrossMatrixTable } from "./cross-matrix";
import { CrossAnalysisTable } from "./cross-table";
import {
  buildCategoryRows,
  buildChannelRows,
  buildCrossMatrix,
  buildCrossRows,
  buildKindRows,
  buildSourceRows,
  POLICIES,
  scale30,
} from "./mock-analysis";
import { ACTION_METRICS, AGENTS, type TrendPoint } from "./mock-data";
import { PolicyCards, PolicyList, PolicyStackBar } from "./policy-strip";
import {
  ActionCards,
  AgentTable,
  SectionHeader,
  TrendLegend,
  TrendWindowSwitch,
  useTrend,
} from "./widgets";

const DAY_MS = 86_400_000;

function periodDays(range: CreatedRangeQuery): number {
  if (range.createdFrom === undefined || range.createdTo === undefined) return 30;
  const ms = new Date(range.createdTo).getTime() - new Date(range.createdFrom).getTime();
  return Math.max(1, Math.round(ms / DAY_MS));
}

function usePeriod() {
  const [range, setRange] = useState<CreatedRangeQuery>(() => presetToCreatedRange("last30Days"));
  const days = periodDays(range);
  const crossRows = useMemo(() => buildCrossRows(days), [days]);
  const crossMatrix = useMemo(() => buildCrossMatrix(days), [days]);
  const channelRows = useMemo(() => buildChannelRows(days), [days]);
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
  return {
    range,
    setRange,
    days,
    crossRows,
    crossMatrix,
    channelRows,
    kindRows,
    categoryRows,
    sourceRows,
    agents,
  };
}

type Period = ReturnType<typeof usePeriod>;

function AnalysisHeader({ variant, period }: { variant: string; period: Period }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">数据看板</h1>
        <p className="text-sm text-muted-foreground">原型 {variant} · mock 数据 · 下钻未实装</p>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">统计周期（作用于分布/交叉/考核）</span>
        <CreatedRangeFilter range={period.range} onChange={period.setRange} />
        <Badge variant="outline" className="tabular-nums">
          {createdRangeLabel(period.range)}
        </Badge>
        <Badge variant="secondary">行动区：当前快照</Badge>
      </div>
    </div>
  );
}

function TrendSection({
  data,
  days,
  setDays,
  extra,
}: {
  data: TrendPoint[];
  days: number;
  setDays: (d: 7 | 30 | 90) => void;
  extra?: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <SectionHeader title="单量趋势" note="新增 vs 完结 · 按日 · 独立于统计周期" />
        <div className="flex items-center gap-3">
          {extra}
          <TrendLegend />
          <TrendWindowSwitch days={days} setDays={setDays} />
        </div>
      </div>
      <Card>
        <CardContent className="pt-4">
          <TrendChart data={data} />
        </CardContent>
      </Card>
    </section>
  );
}

const CROSS_NOTE =
  "行 = 反馈渠道目录，点击行展开实体明细（保司/经纪主体/支付渠道）；列 = 用户反馈渠道归组。监管渠道单与未填写单不在行内，故总计小于渠道图之和。";

function CrossSection({
  period,
  defaultExpandedIds,
}: {
  period: Period;
  defaultExpandedIds?: string[];
}) {
  return (
    <section className="flex flex-col gap-3">
      <SectionHeader title="渠道 × 主题交叉分析" note="统计周期内创建的投诉单" />
      <Card>
        <CardContent className="pt-4">
          <CrossAnalysisTable rows={period.crossRows} defaultExpandedIds={defaultExpandedIds} />
          <p className="mt-3 text-xs text-muted-foreground">{CROSS_NOTE}</p>
        </CardContent>
      </Card>
    </section>
  );
}

export function VariantV4() {
  const period = usePeriod();
  const { days, setDays, data } = useTrend();
  return (
    <div className="flex flex-1 flex-col gap-6 pb-24">
      <AnalysisHeader variant="V4 经典增强" period={period} />
      <section className="flex flex-col gap-3">
        <SectionHeader title="需要行动" note="实时 · 30 秒自动刷新" />
        <ActionCards metrics={ACTION_METRICS} />
      </section>
      <section className="flex flex-col gap-3">
        <SectionHeader title="时效策略" note="各策略在途与超时 · 实时" />
        <PolicyCards policies={POLICIES} />
      </section>
      <TrendSection data={data} days={days} setDays={setDays} />
      <section className="flex flex-col gap-3">
        <SectionHeader title="类型分布" note="统计周期内创建" />
        <div className="grid items-start gap-6 xl:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>工单种类</CardTitle>
            </CardHeader>
            <CardContent>
              <Donut rows={period.kindRows} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>反馈渠道（投诉单）</CardTitle>
            </CardHeader>
            <CardContent className="pt-2">
              <HBars rows={period.channelRows} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>客诉类别 Top 10（投诉单）</CardTitle>
            </CardHeader>
            <CardContent className="pt-2">
              <HBars rows={period.categoryRows} />
            </CardContent>
          </Card>
        </div>
      </section>
      <CrossSection period={period} />
      <section className="flex flex-col gap-3">
        <SectionHeader title="坐席负载与考核" note="负载为实时 · 考核为周期口径" />
        <Card>
          <CardContent className="pt-4">
            <AgentTable agents={period.agents} />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

export function VariantV5() {
  const period = usePeriod();
  const { days, setDays, data } = useTrend();
  return (
    <div className="flex flex-1 flex-col gap-6 pb-24">
      <AnalysisHeader variant="V5 交叉主角" period={period} />
      <section className="flex flex-col gap-3">
        <SectionHeader title="需要行动" note="实时 · 30 秒自动刷新" />
        <ActionCards metrics={ACTION_METRICS} />
      </section>
      <section className="flex flex-col gap-3">
        <SectionHeader title="时效策略" note="在途构成 · 红段为已超时 · 实时" />
        <PolicyStackBar policies={POLICIES} />
      </section>
      <div className="grid items-start gap-6 xl:grid-cols-[2fr_1fr]">
        <TrendSection data={data} days={days} setDays={setDays} />
        <section className="flex flex-col gap-3">
          <SectionHeader title="工单种类" note="周期内创建" />
          <Card>
            <CardContent className="pt-4">
              <Donut rows={period.kindRows} />
            </CardContent>
          </Card>
        </section>
      </div>
      <CrossSection period={period} defaultExpandedIds={["ch-ins"]} />
      <section className="flex flex-col gap-3">
        <SectionHeader title="渠道与类别" note="统计周期内创建" />
        <div className="grid items-start gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>反馈渠道（投诉单）</CardTitle>
            </CardHeader>
            <CardContent className="pt-2">
              <HBars rows={period.channelRows} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>客诉类别 Top 10（投诉单）</CardTitle>
            </CardHeader>
            <CardContent className="pt-2">
              <HBars rows={period.categoryRows} />
            </CardContent>
          </Card>
        </div>
      </section>
      <section className="flex flex-col gap-3">
        <SectionHeader title="坐席负载与考核" note="负载为实时 · 考核为周期口径" />
        <Card>
          <CardContent className="pt-4">
            <AgentTable agents={period.agents} />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

export function VariantV6() {
  const period = usePeriod();
  const { days, setDays, data } = useTrend();
  return (
    <div className="flex flex-1 flex-col gap-6 pb-24">
      <AnalysisHeader variant="V6 双列密度" period={period} />
      <section className="flex flex-col gap-3">
        <SectionHeader title="需要行动" note="实时 · 30 秒自动刷新" />
        <ActionCards metrics={ACTION_METRICS} />
      </section>
      <div className="grid items-start gap-6 xl:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-6">
          <TrendSection data={data} days={days} setDays={setDays} />
          <CrossSection period={period} />
        </div>
        <div className="flex flex-col gap-6">
          <section className="flex flex-col gap-3">
            <SectionHeader title="时效策略" note="实时" />
            <PolicyList policies={POLICIES} />
          </section>
          <section className="flex flex-col gap-3">
            <SectionHeader title="工单种类" note="周期内创建" />
            <Card>
              <CardContent className="pt-4">
                <Donut rows={period.kindRows} />
              </CardContent>
            </Card>
          </section>
          <section className="flex flex-col gap-3">
            <SectionHeader title="反馈渠道" note="投诉单 · 周期内创建" />
            <Card>
              <CardContent className="pt-4">
                <HBars rows={period.channelRows} />
              </CardContent>
            </Card>
          </section>
        </div>
      </div>
      <div className="grid items-start gap-6 xl:grid-cols-[1fr_2fr]">
        <section className="flex flex-col gap-3">
          <SectionHeader title="客诉类别 Top 10" note="投诉单 · 周期内创建" />
          <Card>
            <CardContent className="pt-4">
              <HBars rows={period.categoryRows} />
            </CardContent>
          </Card>
        </section>
        <section className="flex flex-col gap-3">
          <SectionHeader title="坐席负载与考核" note="负载为实时 · 考核为周期口径" />
          <Card>
            <CardContent className="pt-4">
              <AgentTable agents={period.agents} />
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* V7-V9：全量字典交叉矩阵 + 撤特急卡的 4 卡行动区 + 来源分布。三版对比：  */
/* V7 矩阵后置（V4 演进）/ V8 矩阵默认全展开 + 分布右列化 / V9 矩阵前置强热。 */

const ACTION_NOTE =
  "已超时/即将超时含未分配单（未分配也在计时）；待首响仅计已分配。卡间有交集，勿加总。";

const MATRIX_NOTE =
  "行 = 反馈渠道目录全量，列 = 用户反馈渠道目录全量，顺序均跟随字典 displayOrder；监管/未填写行无实体字段可展。总计 = 周期内投诉单总数，与种类环形对账一致。";

function ActionSection4() {
  return (
    <section className="flex flex-col gap-3">
      <SectionHeader title="需要行动" note="实时 · 30 秒自动刷新" />
      <ActionCards metrics={ACTION_METRICS} includeUrgent={false} />
      <p className="text-xs text-muted-foreground">{ACTION_NOTE}</p>
    </section>
  );
}

function MatrixSection({
  period,
  heat,
  defaultExpandedIds,
}: {
  period: Period;
  heat?: "soft" | "strong";
  defaultExpandedIds?: string[];
}) {
  return (
    <section className="flex flex-col gap-3">
      <SectionHeader title="渠道 × 用户反馈渠道交叉分析" note="投诉单 · 统计周期内创建" />
      <Card>
        <CardContent className="pt-4">
          <CrossMatrixTable
            rows={period.crossMatrix}
            heat={heat}
            defaultExpandedIds={defaultExpandedIds}
          />
          <p className="mt-3 text-xs text-muted-foreground">{MATRIX_NOTE}</p>
        </CardContent>
      </Card>
    </section>
  );
}

function DistTriple({ period }: { period: Period }) {
  return (
    <section className="flex flex-col gap-3">
      <SectionHeader title="类型分布" note="统计周期内创建" />
      <div className="grid items-start gap-6 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>工单种类（全部单）</CardTitle>
          </CardHeader>
          <CardContent>
            <Donut rows={period.kindRows} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>客诉类别 Top 10（投诉单）</CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            <HBars rows={period.categoryRows} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>来源构成（全部单）</CardTitle>
          </CardHeader>
          <CardContent>
            <SourceBand rows={period.sourceRows} />
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

function AgentSection({ period }: { period: Period }) {
  return (
    <section className="flex flex-col gap-3">
      <SectionHeader title="坐席负载与考核" note="负载为实时 · 考核为周期口径" />
      <Card>
        <CardContent className="pt-4">
          <AgentTable agents={period.agents} />
        </CardContent>
      </Card>
    </section>
  );
}

export function VariantV7() {
  const period = usePeriod();
  const { days, setDays, data } = useTrend();
  return (
    <div className="flex flex-1 flex-col gap-6 pb-24">
      <AnalysisHeader variant="V7 矩阵后置" period={period} />
      <ActionSection4 />
      <section className="flex flex-col gap-3">
        <SectionHeader title="时效策略" note="各策略在途与超时 · 实时" />
        <PolicyCards policies={POLICIES} />
      </section>
      <TrendSection data={data} days={days} setDays={setDays} />
      <DistTriple period={period} />
      <MatrixSection period={period} />
      <AgentSection period={period} />
    </div>
  );
}

export function VariantV8() {
  const period = usePeriod();
  const { days, setDays, data } = useTrend();
  return (
    <div className="flex flex-1 flex-col gap-6 pb-24">
      <AnalysisHeader variant="V8 全展开明细" period={period} />
      <ActionSection4 />
      <section className="flex flex-col gap-3">
        <SectionHeader title="时效策略" note="各策略在途与超时 · 实时" />
        <PolicyCards policies={POLICIES} />
      </section>
      <div className="grid items-start gap-6 xl:grid-cols-[2fr_1fr]">
        <TrendSection data={data} days={days} setDays={setDays} />
        <div className="flex flex-col gap-6">
          <section className="flex flex-col gap-3">
            <SectionHeader title="工单种类" note="全部单 · 周期内创建" />
            <Card>
              <CardContent className="pt-4">
                <Donut rows={period.kindRows} />
              </CardContent>
            </Card>
          </section>
          <section className="flex flex-col gap-3">
            <SectionHeader title="来源构成" note="全部单 · 周期内创建" />
            <Card>
              <CardContent className="pt-4">
                <SourceBand rows={period.sourceRows} />
              </CardContent>
            </Card>
          </section>
        </div>
      </div>
      <section className="flex flex-col gap-3">
        <SectionHeader title="客诉类别 Top 10" note="投诉单 · 周期内创建" />
        <Card>
          <CardContent className="pt-4">
            <HBars rows={period.categoryRows} />
          </CardContent>
        </Card>
      </section>
      <MatrixSection period={period} defaultExpandedIds={["m-ins", "m-broker", "m-pay"]} />
      <AgentSection period={period} />
    </div>
  );
}

export function VariantV9() {
  const period = usePeriod();
  const { days, setDays, data } = useTrend();
  return (
    <div className="flex flex-1 flex-col gap-6 pb-24">
      <AnalysisHeader variant="V9 矩阵前置强热" period={period} />
      <ActionSection4 />
      <section className="flex flex-col gap-3">
        <SectionHeader title="时效策略" note="各策略在途与超时 · 实时" />
        <PolicyCards policies={POLICIES} />
      </section>
      <MatrixSection period={period} heat="strong" />
      <TrendSection data={data} days={days} setDays={setDays} />
      <DistTriple period={period} />
      <AgentSection period={period} />
    </div>
  );
}
