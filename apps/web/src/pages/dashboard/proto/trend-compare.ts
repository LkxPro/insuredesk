/**
 * PROTOTYPE — throwaway. V10+ 的趋势引擎：跟随统计周期，自动粒度
 *（<2 天按小时 / ≤62 天按日 / >62 天按周），上周期 = 等长前移、按桶序号对齐。
 * 全部确定性 mock：同一天同一小时每次渲染同值。
 */
import type { CreatedRangeQuery } from "@insuredesk/shared";

export type TrendGranularity = "hour" | "day" | "week";

export interface ComparePoint {
  label: string;
  created: number;
  previous: number;
}

export interface CompareTrend {
  points: ComparePoint[];
  granularity: TrendGranularity;
}

const DAY_MS = 86_400_000;

function pseudo(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function dayTotal(date: Date): number {
  const epochDay = Math.floor(date.getTime() / DAY_MS);
  const dow = date.getDay();
  const weekend = dow === 0 || dow === 6;
  return Math.round(
    (weekend ? 11 : 27) + pseudo(epochDay) * (weekend ? 7 : 14) + 4 * Math.sin(epochDay / 9),
  );
}

const HOUR_WEIGHTS = [
  0.3, 0.1, 0.05, 0.05, 0.1, 0.2, 0.5, 1, 2, 3, 4, 4, 3, 2.5, 3, 3.5, 3, 2, 1.5, 1, 0.8, 0.6, 0.4,
  0.3,
];
const HOUR_WEIGHT_SUM = HOUR_WEIGHTS.reduce((a, b) => a + b, 0);

function hourTotal(date: Date, hour: number): number {
  const base = (dayTotal(date) * (HOUR_WEIGHTS[hour] ?? 0)) / HOUR_WEIGHT_SUM;
  const jitter = 0.75 + pseudo(Math.floor(date.getTime() / 3_600_000) + hour) * 0.5;
  return Math.round(base * jitter);
}

export function buildCompareTrend(range: CreatedRangeQuery, now = new Date()): CompareTrend {
  const to = range.createdTo ? new Date(range.createdTo) : now;
  const from = range.createdFrom
    ? new Date(range.createdFrom)
    : new Date(to.getTime() - 29 * DAY_MS);
  const spanDays = Math.max(1, Math.round((to.getTime() - from.getTime()) / DAY_MS) + 1);

  if (spanDays < 2) {
    const dayStart = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    const prevDay = new Date(dayStart.getTime() - DAY_MS);
    const points: ComparePoint[] = [];
    for (let h = 0; h < 24; h++) {
      points.push({
        label: `${h}时`,
        created: hourTotal(dayStart, h),
        previous: hourTotal(prevDay, h),
      });
    }
    return { points, granularity: "hour" };
  }

  const startDay = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const bucketSize = spanDays <= 62 ? 1 : 7;
  const points: ComparePoint[] = [];
  for (let offset = 0; offset < spanDays; offset += bucketSize) {
    const len = Math.min(bucketSize, spanDays - offset);
    const first = new Date(startDay.getTime() + offset * DAY_MS);
    let created = 0;
    let previous = 0;
    for (let i = 0; i < len; i++) {
      created += dayTotal(new Date(startDay.getTime() + (offset + i) * DAY_MS));
      previous += dayTotal(new Date(startDay.getTime() + (offset + i - spanDays) * DAY_MS));
    }
    points.push({
      label:
        bucketSize === 1
          ? `${first.getMonth() + 1}/${first.getDate()}`
          : `${first.getMonth() + 1}/${first.getDate()} 周`,
      created,
      previous,
    });
  }
  return { points, granularity: bucketSize === 1 ? "day" : "week" };
}

export const GRANULARITY_LABELS: Record<TrendGranularity, string> = {
  hour: "按小时",
  day: "按日",
  week: "按周",
};
