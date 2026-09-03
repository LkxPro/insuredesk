import { format } from "date-fns";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { DashboardAnalysisStats } from "./dashboard-types";
import { SectionHeader } from "./section-header";

type Trend = DashboardAnalysisStats["trend"];

const GRANULARITY_LABELS: Record<Trend["granularity"], string> = {
  hour: "按小时",
  day: "按日",
  week: "按周",
};

function bucketLabel(bucketStart: string, granularity: Trend["granularity"]): string {
  const instant = new Date(bucketStart);
  switch (granularity) {
    case "hour":
      return format(instant, "H时");
    case "day":
      return format(instant, "M/d");
    case "week":
      return `${format(instant, "M/d")} 周`;
  }
}

export function TrendSection({ trend }: { trend: Trend }) {
  const previousLabel = trend.granularity === "hour" ? "昨日同时段" : "上周期";
  const data = trend.points.map((point) => ({
    label: bucketLabel(point.bucketStart, trend.granularity),
    created: point.created,
    previous: point.previous,
  }));
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionHeader
          title="单量趋势"
          note={`新增 · ${GRANULARITY_LABELS[trend.granularity]} · 跟随统计周期`}
        />
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span
              className="h-0.5 w-5 rounded-full"
              style={{ backgroundColor: "var(--chart-3)" }}
            />
            本周期新增
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-5 border-t-2 border-dashed border-muted-foreground" />
            {previousLabel}
          </span>
        </div>
      </div>
      <Card>
        <CardContent className="pt-4">
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -16 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                minTickGap={24}
                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              />
              <YAxis
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                width={40}
                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              />
              <Tooltip />
              <Area
                type="monotone"
                dataKey="created"
                name="本周期新增"
                stroke="var(--chart-3)"
                strokeWidth={2}
                fill="var(--chart-3)"
                fillOpacity={0.12}
              />
              <Area
                type="monotone"
                dataKey="previous"
                name={previousLabel}
                stroke="var(--muted-foreground)"
                strokeWidth={1.5}
                strokeDasharray="5 4"
                fill="none"
              />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </section>
  );
}

export function TrendSectionSkeleton() {
  return (
    <section className="flex flex-col gap-3">
      <SectionHeader title="单量趋势" note="新增 · 跟随统计周期" />
      <Card>
        <CardContent className="pt-4">
          <Skeleton className="h-[260px] w-full" />
        </CardContent>
      </Card>
    </section>
  );
}
