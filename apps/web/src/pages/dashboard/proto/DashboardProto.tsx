/**
 * PROTOTYPE — throwaway. Dashboard 重设计的变体对比：/dashboard?proto=1..6，
 * 底部浮动条切换。全 mock 数据（./mock-data、./mock-analysis），无后端、无下钻、
 * 无轮询。评审选定变体后本目录整体删除，共识口径见 issue 记录。
 */
import { Link, useSearchParams } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Donut, HBars, TrendChart } from "./charts";
import {
  ACTION_METRICS,
  AGENTS,
  CATEGORY_DISTRIBUTION,
  CHANNEL_DISTRIBUTION,
  KIND_DISTRIBUTION,
} from "./mock-data";
import {
  VariantV4,
  VariantV5,
  VariantV6,
  VariantV7,
  VariantV8,
  VariantV9,
} from "./variants-analysis";
import {
  VariantV10,
  VariantV11,
  VariantV12,
  VariantV13,
  VariantV14,
  VariantV15,
} from "./variants-final";
import {
  ActionCards,
  AgentTable,
  SectionHeader,
  TrendLegend,
  TrendWindowSwitch,
  useTrend,
} from "./widgets";

function DistributionCards({ dark = false }: { dark?: boolean }) {
  const cardCls = dark ? "border-white/10 bg-white/5" : "";
  const titleCls = dark ? "text-white/80" : "";
  return (
    <div className="grid items-start gap-6 xl:grid-cols-3">
      <Card className={cardCls}>
        <CardHeader>
          <CardTitle className={titleCls}>工单种类</CardTitle>
        </CardHeader>
        <CardContent>
          <Donut rows={KIND_DISTRIBUTION} dark={dark} />
        </CardContent>
      </Card>
      <Card className={cardCls}>
        <CardHeader>
          <CardTitle className={titleCls}>反馈渠道（投诉单）</CardTitle>
        </CardHeader>
        <CardContent className="pt-2">
          <HBars rows={CHANNEL_DISTRIBUTION} dark={dark} />
        </CardContent>
      </Card>
      <Card className={cardCls}>
        <CardHeader>
          <CardTitle className={titleCls}>客诉类别 Top 10（投诉单）</CardTitle>
        </CardHeader>
        <CardContent className="pt-2">
          <HBars rows={CATEGORY_DISTRIBUTION} dark={dark} />
        </CardContent>
      </Card>
    </div>
  );
}

function ProtoHeader({ variant }: { variant: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">数据看板</h1>
        <p className="text-sm text-muted-foreground">
          原型 {variant} · mock 数据 · 下钻/轮询未实装
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant="outline">统计周期：近 30 天（作用于分布与考核）</Badge>
        <Badge variant="secondary">行动区：当前快照</Badge>
      </div>
    </div>
  );
}

function VariantV1() {
  const { days, setDays, data } = useTrend();
  return (
    <div className="flex flex-1 flex-col gap-6 pb-24">
      <ProtoHeader variant="V1 经典网格" />
      <section className="flex flex-col gap-3">
        <SectionHeader title="需要行动" note="实时 · 30 秒自动刷新" />
        <ActionCards metrics={ACTION_METRICS} />
      </section>
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <SectionHeader title="单量趋势" note="新增 vs 完结 · 按日" />
          <div className="flex items-center gap-3">
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
      <section className="flex flex-col gap-3">
        <SectionHeader title="类型分布" note="统计周期内创建" />
        <DistributionCards />
      </section>
      <section className="flex flex-col gap-3">
        <SectionHeader title="坐席负载与考核" note="负载为实时 · 考核为周期口径" />
        <Card>
          <CardContent className="pt-4">
            <AgentTable agents={AGENTS} />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function VariantV2() {
  const { days, setDays, data } = useTrend();
  return (
    <div className="flex flex-1 flex-col gap-6 pb-24">
      <ProtoHeader variant="V2 监控台" />
      <div className="grid items-start gap-6 xl:grid-cols-[360px_1fr]">
        <aside className="flex flex-col gap-3">
          <SectionHeader title="需要行动" note="实时" />
          <ActionCardsVertical />
        </aside>
        <div className="flex flex-col gap-6">
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <SectionHeader title="单量趋势" note="新增 vs 完结 · 按日" />
              <div className="flex items-center gap-3">
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
          <section className="flex flex-col gap-3">
            <SectionHeader title="类型分布" note="统计周期内创建" />
            <DistributionCards />
          </section>
        </div>
      </div>
      <section className="flex flex-col gap-3">
        <SectionHeader title="坐席负载与考核" note="负载为实时 · 考核为周期口径" />
        <Card>
          <CardContent className="pt-4">
            <AgentTable agents={AGENTS} />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function ActionCardsVertical() {
  const rows = [
    {
      key: "overdue",
      label: "已超时",
      value: ACTION_METRICS.overdue,
      sub: "在途已过处理时限",
      tone: "text-destructive",
    },
    {
      key: "dueSoon",
      label: "即将超时",
      value: ACTION_METRICS.dueSoon,
      sub: "距时限不足 2 小时",
      tone: "text-amber-600 dark:text-amber-500",
    },
    {
      key: "firstResponse",
      label: "待首响",
      value: ACTION_METRICS.awaitingFirstResponse,
      sub: `${ACTION_METRICS.firstResponseOverLine} 单已过首响线`,
      tone: "text-amber-600 dark:text-amber-500",
    },
    {
      key: "unassigned",
      label: "未分配",
      value: ACTION_METRICS.unassigned,
      sub: `最老已等待 ${ACTION_METRICS.unassignedOldestWait}`,
      tone: "text-sky-600 dark:text-sky-500",
    },
    {
      key: "urgent",
      label: "特急在途",
      value: ACTION_METRICS.urgent,
      sub: "最高档时效策略",
      tone: "text-violet-600 dark:text-violet-400",
    },
  ];
  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => {
        const hot = row.value > 0;
        return (
          <Card key={row.key} className="gap-1 py-3">
            <CardContent className="flex items-center justify-between gap-3 px-4">
              <div className="flex flex-col">
                <span className="text-sm font-medium">{row.label}</span>
                <span className="text-xs text-muted-foreground">{row.sub}</span>
              </div>
              <span
                className={cn(
                  "text-3xl font-semibold tabular-nums",
                  hot ? row.tone : "text-muted-foreground/50",
                )}
              >
                {row.value}
              </span>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function VariantV3() {
  const { data } = useTrend();
  const tiles = [
    { key: "overdue", label: "已超时", value: ACTION_METRICS.overdue, tone: "text-red-400" },
    { key: "dueSoon", label: "即将超时", value: ACTION_METRICS.dueSoon, tone: "text-amber-300" },
    {
      key: "firstResponse",
      label: "待首响",
      value: ACTION_METRICS.awaitingFirstResponse,
      tone: "text-amber-300",
    },
    { key: "unassigned", label: "未分配", value: ACTION_METRICS.unassigned, tone: "text-sky-300" },
    { key: "urgent", label: "特急在途", value: ACTION_METRICS.urgent, tone: "text-violet-300" },
  ];
  return (
    <div className="-m-4 flex flex-1 flex-col gap-8 bg-neutral-950 p-6 pb-28 text-neutral-100 md:-m-6 md:p-10">
      <div className="flex items-baseline justify-between">
        <h1 className="text-3xl font-bold tracking-tight">工单运营监控</h1>
        <span className="text-sm text-white/40">原型 V3 深色大屏 · mock 数据</span>
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {tiles.map((tile) => {
          const hot = tile.value > 0;
          return (
            <div key={tile.key} className="rounded-2xl border border-white/10 bg-white/5 px-6 py-5">
              <div className="text-sm text-white/50">{tile.label}</div>
              <div
                className={cn(
                  "mt-2 font-bold tabular-nums leading-none",
                  "text-6xl",
                  hot ? tile.tone : "text-white/20",
                )}
              >
                {tile.value}
              </div>
            </div>
          );
        })}
      </div>
      <div className="grid items-start gap-6 xl:grid-cols-[3fr_2fr]">
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <SectionHeader title="单量趋势 · 近 30 天" dark />
            <TrendLegend dark />
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <TrendChart data={data} dark />
          </div>
        </section>
        <section className="flex flex-col gap-4">
          <SectionHeader title="种类与渠道" note="近 30 天创建" dark />
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <Donut rows={KIND_DISTRIBUTION} dark />
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <HBars rows={CHANNEL_DISTRIBUTION} dark />
          </div>
        </section>
      </div>
      <section className="flex flex-col gap-3">
        <SectionHeader title="坐席负载与考核" dark />
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <AgentTable agents={AGENTS} dark />
        </div>
      </section>
    </div>
  );
}

const VARIANTS = [
  { key: "1", label: "V1", hint: "经典网格（评审基线）" },
  { key: "2", label: "V2", hint: "监控台：左栏行动区" },
  { key: "3", label: "V3", hint: "深色大屏" },
  { key: "4", label: "V4", hint: "经典增强：策略卡片排 + 交叉表通栏" },
  { key: "5", label: "V5", hint: "交叉主角：策略堆叠条，交叉表上移" },
  { key: "6", label: "V6", hint: "双列密度：左趋势/交叉，右策略/分布" },
  { key: "7", label: "V7", hint: "矩阵后置：全量字典矩阵 + 热力 + 数据条（V4 演进）" },
  { key: "8", label: "V8", hint: "矩阵默认全展开，分布右列化" },
  { key: "9", label: "V9", hint: "矩阵前置 + 强热色块" },
  { key: "10", label: "V10", hint: "基线修正：双极热力+占比切换+环比趋势+吸顶周期条" },
  { key: "11", label: "V11", hint: "柱状趋势 + 全表归一热力" },
  { key: "12", label: "V12", hint: "迷你胶囊吸顶 + 纯线趋势 + 徽标表头" },
  { key: "13", label: "V13", hint: "吸顶标题带：标题+周期胶囊同行常驻" },
  { key: "14", label: "V14", hint: "fixed 浮动胶囊：零布局占位" },
  { key: "15", label: "V15", hint: "单行紧凑吸顶带" },
] as const;

export function DashboardProto({ variant }: { variant: string }) {
  const [, setSearchParams] = useSearchParams();
  const active = VARIANTS.find((v) => v.key === variant) ?? VARIANTS[0];
  return (
    <>
      {active.key === "1" && <VariantV1 />}
      {active.key === "2" && <VariantV2 />}
      {active.key === "3" && <VariantV3 />}
      {active.key === "4" && <VariantV4 />}
      {active.key === "5" && <VariantV5 />}
      {active.key === "6" && <VariantV6 />}
      {active.key === "7" && <VariantV7 />}
      {active.key === "8" && <VariantV8 />}
      {active.key === "9" && <VariantV9 />}
      {active.key === "10" && <VariantV10 />}
      {active.key === "11" && <VariantV11 />}
      {active.key === "12" && <VariantV12 />}
      {active.key === "13" && <VariantV13 />}
      {active.key === "14" && <VariantV14 />}
      {active.key === "15" && <VariantV15 />}
      <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full border bg-background/95 px-2 py-1.5 shadow-lg backdrop-blur">
        <span className="px-2 text-xs text-muted-foreground">原型</span>
        {VARIANTS.map((v) => (
          <button
            key={v.key}
            type="button"
            title={v.hint}
            onClick={() => setSearchParams({ proto: v.key })}
            className={cn(
              "rounded-full px-3 py-1 text-xs transition-colors",
              active.key === v.key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent",
            )}
          >
            {v.label}
          </button>
        ))}
        <Link
          to="/dashboard"
          className="rounded-full px-3 py-1 text-xs text-muted-foreground hover:bg-accent"
        >
          退出原型
        </Link>
      </div>
    </>
  );
}
