/**
 * PROTOTYPE — throwaway. 时效策略条的三种形态，V4/V5/V6 各取一种对比：
 * 卡片排（与行动卡同构）/ 横向堆叠条（构成 + 超时叠红）/ 竖排列表（窄栏用）。
 */
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { PolicyRow } from "./mock-analysis";

function PolicyNums({ p, dense = false }: { p: PolicyRow; dense?: boolean }) {
  return (
    <div className={cn("flex items-baseline gap-3 text-xs tabular-nums", dense && "gap-2")}>
      <span className={cn(p.overdue > 0 ? "text-destructive" : "text-muted-foreground/50")}>
        超时 {p.overdue}
      </span>
      <span className={cn(p.dueSoon > 0 ? "text-amber-600" : "text-muted-foreground/50")}>
        预警 {p.dueSoon}
      </span>
    </div>
  );
}

export function PolicyCards({ policies }: { policies: PolicyRow[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      {policies.map((p) => (
        <Card key={p.id} className="gap-1 py-3">
          <CardContent className="flex flex-col gap-1 px-4">
            <div className="flex items-center justify-between gap-2">
              <span className={cn("text-sm font-medium", p.muted && "text-muted-foreground")}>
                {p.name}
              </span>
              <span className="rounded-full border px-1.5 text-[10px] text-muted-foreground">
                {p.limit}
              </span>
            </div>
            <div
              className={cn(
                "text-2xl font-semibold tabular-nums",
                p.muted && "text-muted-foreground/60",
              )}
            >
              {p.inFlight}
              <span className="ml-1 text-xs font-normal text-muted-foreground">在途</span>
            </div>
            {p.note ? (
              <span className="text-xs text-muted-foreground">{p.note}</span>
            ) : (
              <PolicyNums p={p} dense />
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

const STACK_COLORS = [
  "var(--chart-3)",
  "var(--chart-2)",
  "var(--chart-1)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--muted-foreground)",
];

export function PolicyStackBar({ policies }: { policies: PolicyRow[] }) {
  const total = policies.reduce((s, p) => s + p.inFlight, 0);
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 px-4 py-4">
        <div className="flex h-5 w-full overflow-hidden rounded-full">
          {policies.map((p, i) => (
            <div
              key={p.id}
              className="relative h-full"
              style={{
                width: `${total === 0 ? 0 : (p.inFlight / total) * 100}%`,
                backgroundColor: p.muted ? "var(--muted)" : STACK_COLORS[i % STACK_COLORS.length],
                opacity: p.muted ? 0.5 : 1,
              }}
              title={`${p.name} 在途 ${p.inFlight}`}
            >
              {p.overdue > 0 && (
                <div
                  className="absolute inset-y-0 left-0 bg-destructive"
                  style={{ width: `${(p.overdue / p.inFlight) * 100}%` }}
                  title={`${p.name} 已超时 ${p.overdue}`}
                />
              )}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
          {policies.map((p, i) => (
            <span key={p.id} className="flex items-center gap-1.5">
              <span
                className="size-2.5 rounded-sm"
                style={{
                  backgroundColor: p.muted ? "var(--muted)" : STACK_COLORS[i % STACK_COLORS.length],
                }}
              />
              <span className={cn(p.muted && "text-muted-foreground")}>{p.name}</span>
              <span className="tabular-nums text-muted-foreground">{p.inFlight}</span>
              {p.overdue > 0 && (
                <span className="tabular-nums text-destructive">超时 {p.overdue}</span>
              )}
            </span>
          ))}
          <span className="ml-auto text-muted-foreground">红色段 = 已超时</span>
        </div>
      </CardContent>
    </Card>
  );
}

export function PolicyList({ policies }: { policies: PolicyRow[] }) {
  return (
    <Card>
      <CardContent className="flex flex-col divide-y px-4 py-2">
        {policies.map((p) => (
          <div key={p.id} className="flex items-center justify-between gap-2 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <span className={cn("truncate text-sm", p.muted && "text-muted-foreground")}>
                {p.name}
              </span>
              <span className="shrink-0 rounded-full border px-1.5 text-[10px] text-muted-foreground">
                {p.limit}
              </span>
            </div>
            <div className="flex shrink-0 items-baseline gap-3">
              <span className="text-lg font-semibold tabular-nums">{p.inFlight}</span>
              <PolicyNums p={p} dense />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
