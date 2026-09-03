import { TICKET_SOURCE_LABELS } from "@insuredesk/shared";
import { Cell, Pie, PieChart } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { DashboardAnalysisStats } from "./dashboard-types";
import { SectionHeader } from "./section-header";

type Kinds = DashboardAnalysisStats["kinds"];
type Categories = DashboardAnalysisStats["categories"];
type Sources = DashboardAnalysisStats["sources"];

const DONUT_COLORS = [
  "var(--chart-3)",
  "var(--chart-1)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-2)",
];

const BAND_COLORS = [
  "var(--chart-3)",
  "var(--chart-2)",
  "var(--chart-4)",
  "var(--chart-1)",
  "var(--chart-5)",
];

const shareText = (count: number, total: number) =>
  total === 0 ? "—" : `${Math.round((count / total) * 100)}%`;

function KindDonut({ kinds }: { kinds: Kinds }) {
  const total = kinds.reduce((sum, row) => sum + row.count, 0);
  return (
    <div className="flex flex-wrap items-center gap-6">
      <div className="relative size-36 shrink-0">
        <PieChart width={144} height={144}>
          <Pie
            data={[{ v: 1 }]}
            dataKey="v"
            innerRadius="62%"
            outerRadius="85%"
            strokeWidth={0}
            fill="var(--muted)"
            isAnimationActive={false}
          />
          {total > 0 && (
            <Pie
              data={kinds}
              dataKey="count"
              nameKey="name"
              innerRadius="62%"
              outerRadius="85%"
              strokeWidth={0}
              isAnimationActive={false}
            >
              {kinds.map((row, index) => (
                <Cell key={row.kindId} fill={DONUT_COLORS[index % DONUT_COLORS.length]} />
              ))}
            </Pie>
          )}
        </PieChart>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-semibold tabular-nums">{total}</span>
          <span className="text-[10px] text-muted-foreground">周期内创建</span>
        </div>
      </div>
      <div className="flex flex-col gap-2 text-sm">
        {kinds.map((row, index) => (
          <div key={row.kindId} className="flex items-center gap-2">
            <span
              className="size-3 shrink-0 rounded-sm"
              style={{ backgroundColor: DONUT_COLORS[index % DONUT_COLORS.length] }}
            />
            <span>{row.name}</span>
            <span className="tabular-nums text-muted-foreground">
              {row.count} · {shareText(row.count, total)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CategoryBars({ categories }: { categories: Categories }) {
  const max = Math.max(...categories.map((row) => row.count), 1);
  const total = categories.reduce((sum, row) => sum + row.count, 0);
  return (
    <div className="flex flex-col gap-2">
      {categories.map((row) => {
        const muted = row.categoryId === null;
        return (
          <div
            key={`${row.categoryId ?? "null"}-${row.name}`}
            className="flex items-center gap-3 text-sm"
          >
            <span
              className={cn(
                "w-20 shrink-0 truncate text-right",
                muted ? "text-muted-foreground/60" : "text-muted-foreground",
              )}
            >
              {row.name}
            </span>
            <div className="h-4 flex-1 rounded-sm bg-muted">
              <div
                className={cn("h-full rounded-sm", muted && "bg-muted-foreground/25")}
                style={{
                  width: `${(row.count / max) * 100}%`,
                  backgroundColor: muted ? undefined : "var(--chart-3)",
                }}
              />
            </div>
            <span className="w-16 shrink-0 tabular-nums text-xs text-muted-foreground">
              {row.count} · {shareText(row.count, total)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function SourceBand({ sources }: { sources: Sources }) {
  const total = sources.reduce((sum, row) => sum + row.count, 0);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-6 w-full overflow-hidden rounded-full">
        {sources.map((row, index) => (
          <div
            key={row.source}
            style={{
              width: `${total === 0 ? 0 : (row.count / total) * 100}%`,
              backgroundColor: BAND_COLORS[index % BAND_COLORS.length],
            }}
            title={`${TICKET_SOURCE_LABELS[row.source]} ${row.count}`}
          />
        ))}
      </div>
      <div className="flex flex-col gap-1.5 text-sm">
        {sources.map((row, index) => (
          <div key={row.source} className="flex items-center gap-2">
            <span
              className="size-3 shrink-0 rounded-sm"
              style={{ backgroundColor: BAND_COLORS[index % BAND_COLORS.length] }}
            />
            <span>{TICKET_SOURCE_LABELS[row.source]}</span>
            <span className="ml-auto tabular-nums text-muted-foreground">
              {row.count} · {shareText(row.count, total)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DistributionSection({
  kinds,
  categories,
  sources,
}: {
  kinds: Kinds;
  categories: Categories;
  sources: Sources;
}) {
  return (
    <section className="flex flex-col gap-3">
      <SectionHeader title="类型分布" note="统计周期内创建" />
      <div className="grid items-stretch gap-6 xl:grid-cols-3">
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle>工单种类（全部单）</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col justify-center">
            <KindDonut kinds={kinds} />
          </CardContent>
        </Card>
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle>客诉类别 Top 10（投诉单）</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 pt-2">
            <CategoryBars categories={categories} />
          </CardContent>
        </Card>
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle>来源构成（全部单）</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col justify-center">
            <SourceBand sources={sources} />
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

export function DistributionSectionSkeleton() {
  return (
    <section className="flex flex-col gap-3">
      <SectionHeader title="类型分布" note="统计周期内创建" />
      <div className="grid items-stretch gap-6 xl:grid-cols-3">
        {["kinds", "categories", "sources"].map((card) => (
          <Card key={card} className="flex flex-col">
            <CardHeader>
              <Skeleton className="h-5 w-36" />
            </CardHeader>
            <CardContent className="flex-1">
              <Skeleton className="h-32 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
