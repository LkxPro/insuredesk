/**
 * PROTOTYPE — throwaway. 手绘 SVG 图表：趋势双线图 / 横向条形 / 环形。
 * 零新依赖（原型不引入 recharts，选型留给落地）；只求评审时看得懂，不求完备交互。
 */
import type { DistributionRow, TrendPoint } from "./mock-data";
import type { ComparePoint } from "./trend-compare";

const W = 760;
const H = 240;
const PAD = { top: 12, right: 16, bottom: 24, left: 36 };

function buildPath(points: Array<{ x: number; y: number }>): string {
  return points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");
}

export function TrendChart({ data, dark = false }: { data: TrendPoint[]; dark?: boolean }) {
  const max = Math.max(...data.map((p) => p.created), 1);
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (i / Math.max(data.length - 1, 1)) * innerW;
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;

  const toPoints = (key: "created" | "completed") =>
    data.map((p, i) => ({ x: x(i), y: y(p[key]) }));
  const createdPts = toPoints("created");
  const completedPts = toPoints("completed");
  const areaPath = (pts: Array<{ x: number; y: number }>) => {
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (!first || !last) return "";
    const base = (PAD.top + innerH).toFixed(1);
    return `${buildPath(pts)} L${last.x.toFixed(1)},${base} L${first.x.toFixed(1)},${base} Z`;
  };

  const gridVals = [0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f));
  const labelEvery = Math.max(1, Math.ceil(data.length / 8));
  const gridColor = dark ? "rgba(255,255,255,0.08)" : "var(--border)";
  const textColor = dark ? "rgba(255,255,255,0.45)" : "var(--muted-foreground)";

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="单量趋势">
      {gridVals.map((v) => (
        <g key={v}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke={gridColor} />
          <text x={PAD.left - 6} y={y(v) + 3} textAnchor="end" fontSize="10" fill={textColor}>
            {v}
          </text>
        </g>
      ))}
      <path d={areaPath(createdPts)} fill="var(--chart-3)" opacity={dark ? 0.25 : 0.12} />
      <path d={areaPath(completedPts)} fill="var(--chart-2)" opacity={dark ? 0.25 : 0.12} />
      <path d={buildPath(createdPts)} fill="none" stroke="var(--chart-3)" strokeWidth="2" />
      <path d={buildPath(completedPts)} fill="none" stroke="var(--chart-2)" strokeWidth="2" />
      {data.map((p, i) =>
        i % labelEvery === 0 || p.isToday ? (
          <text
            key={p.date}
            x={x(i)}
            y={H - 8}
            textAnchor="middle"
            fontSize="10"
            fill={textColor}
            fontWeight={p.isToday ? 700 : 400}
          >
            {p.isToday ? "今日" : p.date}
          </text>
        ) : null,
      )}
    </svg>
  );
}

export function HBars({
  rows,
  dark = false,
  barColor = "var(--chart-3)",
}: {
  rows: DistributionRow[];
  dark?: boolean;
  barColor?: string;
}) {
  const max = Math.max(...rows.map((r) => r.count), 1);
  const total = rows.reduce((s, r) => s + r.count, 0);
  return (
    <div className="flex flex-col gap-2">
      {rows.map((row) => (
        <div key={row.id} className="flex items-center gap-3 text-sm">
          <span
            className={`w-20 shrink-0 truncate text-right ${
              row.unfilled
                ? dark
                  ? "text-white/35"
                  : "text-muted-foreground/60"
                : dark
                  ? "text-white/70"
                  : "text-muted-foreground"
            }`}
          >
            {row.name}
          </span>
          <div
            className={`h-4 flex-1 rounded-sm ${dark ? "bg-white/8" : "bg-muted"}`}
            role="presentation"
          >
            <div
              className={`h-full rounded-sm ${row.unfilled ? (dark ? "bg-white/20" : "bg-muted-foreground/25") : ""}`}
              style={{
                width: `${(row.count / max) * 100}%`,
                backgroundColor: row.unfilled ? undefined : barColor,
              }}
            />
          </div>
          <span
            className={`w-16 shrink-0 tabular-nums text-xs ${dark ? "text-white/60" : "text-muted-foreground"}`}
          >
            {row.count} · {total === 0 ? "—" : `${Math.round((row.count / total) * 100)}%`}
          </span>
        </div>
      ))}
    </div>
  );
}

const DONUT_COLORS = ["var(--chart-3)", "var(--chart-1)", "var(--chart-4)", "var(--chart-5)"];

const BAND_COLORS = [
  "var(--chart-3)",
  "var(--chart-2)",
  "var(--chart-4)",
  "var(--chart-1)",
  "var(--chart-5)",
];

/** 来源构成：单条 100% 分段带 + 图例。 */
export function SourceBand({ rows, dark = false }: { rows: DistributionRow[]; dark?: boolean }) {
  const total = rows.reduce((s, r) => s + r.count, 0);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-6 w-full overflow-hidden rounded-full">
        {rows.map((row, i) => (
          <div
            key={row.id}
            style={{
              width: `${total === 0 ? 0 : (row.count / total) * 100}%`,
              backgroundColor: BAND_COLORS[i % BAND_COLORS.length],
            }}
            title={`${row.name} ${row.count}`}
          />
        ))}
      </div>
      <div className="flex flex-col gap-1.5 text-sm">
        {rows.map((row, i) => (
          <div key={row.id} className="flex items-center gap-2">
            <span
              className="size-3 shrink-0 rounded-sm"
              style={{ backgroundColor: BAND_COLORS[i % BAND_COLORS.length] }}
            />
            <span className={dark ? "text-white/80" : ""}>{row.name}</span>
            <span
              className={`ml-auto tabular-nums ${dark ? "text-white/50" : "text-muted-foreground"}`}
            >
              {row.count} · {total === 0 ? "—" : `${Math.round((row.count / total) * 100)}%`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Donut({ rows, dark = false }: { rows: DistributionRow[]; dark?: boolean }) {
  const total = rows.reduce((s, r) => s + r.count, 0);
  const R = 52;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="flex items-center gap-6">
      <svg viewBox="0 0 140 140" className="size-36 shrink-0" role="img" aria-label="种类分布">
        <circle
          cx="70"
          cy="70"
          r={R}
          fill="none"
          stroke={dark ? "rgba(255,255,255,0.08)" : "var(--muted)"}
          strokeWidth="18"
        />
        {rows.map((row, i) => {
          const frac = total === 0 ? 0 : row.count / total;
          const dash = `${(frac * C).toFixed(2)} ${(C - frac * C).toFixed(2)}`;
          const dashOffset = (-offset * C).toFixed(2);
          offset += frac;
          return (
            <circle
              key={row.id}
              cx="70"
              cy="70"
              r={R}
              fill="none"
              stroke={DONUT_COLORS[i % DONUT_COLORS.length]}
              strokeWidth="18"
              strokeDasharray={dash}
              strokeDashoffset={dashOffset}
              transform="rotate(-90 70 70)"
            />
          );
        })}
        <text
          x="70"
          y="66"
          textAnchor="middle"
          fontSize="20"
          fontWeight="600"
          className={dark ? "fill-white" : "fill-foreground"}
        >
          {total}
        </text>
        <text
          x="70"
          y="84"
          textAnchor="middle"
          fontSize="10"
          className={dark ? "fill-white/50" : "fill-muted-foreground"}
        >
          周期内创建
        </text>
      </svg>
      <div className="flex flex-col gap-2 text-sm">
        {rows.map((row, i) => (
          <div key={row.id} className="flex items-center gap-2">
            <span
              className="size-3 rounded-sm"
              style={{ backgroundColor: DONUT_COLORS[i % DONUT_COLORS.length] }}
            />
            <span className={dark ? "text-white/80" : ""}>{row.name}</span>
            <span className={`tabular-nums ${dark ? "text-white/50" : "text-muted-foreground"}`}>
              {row.count} · {total === 0 ? "—" : `${Math.round((row.count / total) * 100)}%`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* V10+ 对比趋势：本周期新增（实） vs 上周期新增（灰虚线），三种形态对比。 */

export function CompareLegend() {
  return (
    <div className="flex items-center gap-4 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="h-0.5 w-5 rounded-full" style={{ backgroundColor: "var(--chart-3)" }} />
        本周期新增
      </span>
      <span className="flex items-center gap-1.5">
        <span className="w-5 border-t-2 border-dashed border-muted-foreground" />
        上周期新增
      </span>
    </div>
  );
}

export function CompareTrendChart({
  points,
  mode = "area",
}: {
  points: ComparePoint[];
  mode?: "area" | "bar" | "line";
}) {
  const max = Math.max(...points.flatMap((p) => [p.created, p.previous]), 1);
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (i / Math.max(points.length - 1, 1)) * innerW;
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;

  const toPts = (key: "created" | "previous") => points.map((p, i) => ({ x: x(i), y: y(p[key]) }));
  const createdPts = toPts("created");
  const previousPts = toPts("previous");
  const first = createdPts[0];
  const last = createdPts[createdPts.length - 1];
  const areaPath =
    first && last
      ? `${buildPath(createdPts)} L${last.x.toFixed(1)},${(PAD.top + innerH).toFixed(1)} L${first.x.toFixed(1)},${(PAD.top + innerH).toFixed(1)} Z`
      : "";

  const gridVals = [0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f));
  const labelEvery = Math.max(1, Math.ceil(points.length / 8));
  const barW = innerW / Math.max(points.length, 1);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="单量趋势">
      {gridVals.map((v) => (
        <g key={v}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--border)" />
          <text
            x={PAD.left - 6}
            y={y(v) + 3}
            textAnchor="end"
            fontSize="10"
            fill="var(--muted-foreground)"
          >
            {v}
          </text>
        </g>
      ))}
      {mode === "bar" &&
        points.map((p, i) => (
          <rect
            key={`bar-${p.label}`}
            x={x(i) - barW * 0.3}
            y={y(p.created)}
            width={barW * 0.6}
            height={Math.max(PAD.top + innerH - y(p.created), 0)}
            fill="var(--chart-3)"
            opacity="0.75"
            rx="1"
          />
        ))}
      {mode === "area" && <path d={areaPath} fill="var(--chart-3)" opacity={0.12} />}
      {mode !== "bar" && (
        <path d={buildPath(createdPts)} fill="none" stroke="var(--chart-3)" strokeWidth="2" />
      )}
      <path
        d={buildPath(previousPts)}
        fill="none"
        stroke="var(--muted-foreground)"
        strokeWidth="1.5"
        strokeDasharray="5 4"
        opacity="0.8"
      />
      {points.map((p, i) =>
        i % labelEvery === 0 || i === points.length - 1 ? (
          <text
            key={p.label}
            x={x(i)}
            y={H - 8}
            textAnchor="middle"
            fontSize="10"
            fill="var(--muted-foreground)"
          >
            {p.label}
          </text>
        ) : null,
      )}
    </svg>
  );
}
