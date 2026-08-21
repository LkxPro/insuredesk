import type { CreatedRangeQuery } from "@insuredesk/shared";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  CREATED_RANGE_PRESETS,
  createdRangeLabel,
  createdRangeToLocalDates,
  localDatesToCreatedRange,
  matchCreatedRangePreset,
  presetToCreatedRange,
} from "@/lib/created-range";

export function CreatedRangeFilter({
  range,
  onChange,
}: {
  range: CreatedRangeQuery;
  onChange: (range: CreatedRangeQuery) => void;
}) {
  const [open, setOpen] = useState(false);
  const active = matchCreatedRangePreset(range);
  const hasRange = range.createdFrom !== undefined || range.createdTo !== undefined;
  const custom = hasRange && active === null;
  const [showCalendar, setShowCalendar] = useState(custom);
  const [draft, setDraft] = useState<DateRange | undefined>(() => toDateRange(range));
  const [pendingFrom, setPendingFrom] = useState<Date | null>(null);

  /**
   * 自定义区间要两次点击才成立。react-day-picker 首点回传 from === to 的单日区间，
   * 与"真的只想选一天"在 payload 上无从分辨，故起点由本组件记账；第二点落在起点
   * 之前时按早晚归位，用户不必先点早的那天。
   */
  function applyCustom(selected: DateRange | undefined) {
    setDraft(selected);
    const clicked =
      selected?.to && +selected.to !== +(selected.from ?? 0) ? selected.to : undefined;
    const second = clicked ?? selected?.from;
    if (pendingFrom === null || !second) {
      setPendingFrom(selected?.from ?? null);
      return;
    }
    const [start, end] = +pendingFrom <= +second ? [pendingFrom, second] : [second, pendingFrom];
    const next = localDatesToCreatedRange(format(start, "yyyy-MM-dd"), format(end, "yyyy-MM-dd"));
    if (next) {
      setPendingFrom(null);
      onChange(next);
      setOpen(false);
    }
  }

  return (
    <Popover
      open={open}
      // 每次打开都回到当前区间的视图：上次编辑到一半的草稿不留到下一次
      onOpenChange={(next) => {
        if (next) {
          setDraft(toDateRange(range));
          setShowCalendar(custom);
          setPendingFrom(null);
        }
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        {/* 排序表头也叫「创建时间」：可及名字加「筛选」后缀区分二者 */}
        <Button
          variant="outline"
          size="sm"
          aria-label={`创建时间筛选：${createdRangeLabel(range)}`}
          className="font-normal"
        >
          创建时间
          {hasRange && (
            <span className="text-muted-foreground tabular-nums">{createdRangeLabel(range)}</span>
          )}
          <ChevronDown data-icon="inline-end" className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-1">
        <ul className="w-40">
          <li>
            <PresetItem
              label="全部"
              selected={!hasRange}
              onSelect={() => {
                onChange({});
                setOpen(false);
              }}
            />
          </li>
          {CREATED_RANGE_PRESETS.map((preset) => (
            <li key={preset.value}>
              <PresetItem
                label={preset.label}
                selected={active === preset.value}
                onSelect={() => {
                  onChange(presetToCreatedRange(preset.value));
                  setOpen(false);
                }}
              />
            </li>
          ))}
          <li>
            <PresetItem label="自定义" selected={custom} onSelect={() => setShowCalendar(true)} />
          </li>
        </ul>
        {showCalendar && (
          <Calendar
            mode="range"
            required={false}
            selected={draft}
            defaultMonth={draft?.from}
            captionLayout="dropdown"
            navLayout="after"
            locale={zhCN}
            formatters={{ formatMonthDropdown: (date) => format(date, "M月", { locale: zhCN }) }}
            onSelect={applyCustom}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

function toDateRange(range: CreatedRangeQuery): DateRange | undefined {
  const { from, to } = createdRangeToLocalDates(range);
  if (!from && !to) {
    return undefined;
  }
  return {
    from: from ? new Date(`${from}T00:00:00`) : undefined,
    to: to ? new Date(`${to}T00:00:00`) : undefined,
  };
}

function PresetItem({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-pressed={selected}
      className="w-full justify-start font-normal aria-pressed:bg-accent"
      onClick={onSelect}
    >
      {label}
    </Button>
  );
}
