import type { CreatedRangeQuery } from "@insuredesk/shared";
import {
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
} from "date-fns";
import { isCompleteLocalDate } from "./local-date-time";

/**
 * 创建时间预设 ↔ 绝对时刻的换算，以及回显反查。契约只收 instant，预设纯属前端
 * 的糖：日界一律按浏览器时区算，周起始为周一。
 *
 * 反查的固有代价：今天选「本月」生成的链接明天打开会回显「自定义」——日期没
 * 变，但已不等于新的本月边界。分享一段数据的链接时，这正是想要的语义。
 */

/** 两端都定死的区间——预设换算与自定义输入的产物。 */
export type ResolvedCreatedRange = Required<CreatedRangeQuery>;

const WEEK_OPTIONS = { weekStartsOn: 1 } as const;

/** 展示顺序 = 反查优先级：同一区间同时符合多个预设时取靠前者。 */
export const CREATED_RANGE_PRESETS = [
  { value: "today", label: "本日" },
  { value: "thisWeek", label: "本周" },
  { value: "thisMonth", label: "本月" },
  { value: "last7Days", label: "近 7 天" },
  { value: "last30Days", label: "近 30 天" },
] as const;

export type CreatedRangePreset = (typeof CREATED_RANGE_PRESETS)[number]["value"];

const PRESET_LABELS: Record<CreatedRangePreset, string> = Object.fromEntries(
  CREATED_RANGE_PRESETS.map((preset) => [preset.value, preset.label]),
) as Record<CreatedRangePreset, string>;

function toRange(from: Date, to: Date): ResolvedCreatedRange {
  return { createdFrom: from.toISOString(), createdTo: to.toISOString() };
}

/**
 * 预设 → 绝对起止。本日/本周/本月取整周期：创建时刻恒不晚于当下，整周期与
 * 「截止到今天」筛出的行集相同，取写法简单的那个。近 N 天含今天，故回退 N-1 天。
 */
export function presetToCreatedRange(
  preset: CreatedRangePreset,
  now: Date = new Date(),
): ResolvedCreatedRange {
  switch (preset) {
    case "today":
      return toRange(startOfDay(now), endOfDay(now));
    case "thisWeek":
      return toRange(startOfWeek(now, WEEK_OPTIONS), endOfWeek(now, WEEK_OPTIONS));
    case "thisMonth":
      return toRange(startOfMonth(now), endOfMonth(now));
    case "last7Days":
      return toRange(startOfDay(subDays(now, 6)), endOfDay(now));
    case "last30Days":
      return toRange(startOfDay(subDays(now, 29)), endOfDay(now));
  }
}

/** 自定义 `YYYY-MM-DD` 起止 → 撑满两端日界的绝对区间；任一端残缺即换不出区间。 */
export function localDatesToCreatedRange(from: string, to: string): ResolvedCreatedRange | null {
  if (!isCompleteLocalDate(from) || !isCompleteLocalDate(to)) {
    return null;
  }
  return toRange(startOfDay(new Date(`${from}T00:00:00`)), endOfDay(new Date(`${to}T00:00:00`)));
}

/** 绝对区间 → 自定义控件的 `YYYY-MM-DD` 回填值；缺的一端留空。 */
export function createdRangeToLocalDates(range: CreatedRangeQuery): { from: string; to: string } {
  const toLocalDate = (iso: string | undefined) =>
    iso === undefined ? "" : format(new Date(iso), "yyyy-MM-dd");
  return { from: toLocalDate(range.createdFrom), to: toLocalDate(range.createdTo) };
}

/** 起止恰好等于某预设的边界则反查出该预设；单边区间永不匹配。 */
export function matchCreatedRangePreset(
  range: CreatedRangeQuery,
  now: Date = new Date(),
): CreatedRangePreset | null {
  if (range.createdFrom === undefined || range.createdTo === undefined) {
    return null;
  }
  const from = new Date(range.createdFrom).getTime();
  const to = new Date(range.createdTo).getTime();
  return (
    CREATED_RANGE_PRESETS.find((preset) => {
      const candidate = presetToCreatedRange(preset.value, now);
      return (
        new Date(candidate.createdFrom).getTime() === from &&
        new Date(candidate.createdTo).getTime() === to
      );
    })?.value ?? null
  );
}

/** 触发器回显：全部 / 预设名 / 自定义区间（单边区间也给可读文案）。 */
export function createdRangeLabel(range: CreatedRangeQuery, now: Date = new Date()): string {
  if (range.createdFrom === undefined && range.createdTo === undefined) {
    return "全部";
  }
  const preset = matchCreatedRangePreset(range, now);
  if (preset) {
    return PRESET_LABELS[preset];
  }
  const day = (iso: string) => format(new Date(iso), "MM-dd");
  if (range.createdFrom === undefined) {
    return `自定义 ${day(range.createdTo as string)} 止`;
  }
  if (range.createdTo === undefined) {
    return `自定义 ${day(range.createdFrom)} 起`;
  }
  return `自定义 ${day(range.createdFrom)} ~ ${day(range.createdTo)}`;
}
