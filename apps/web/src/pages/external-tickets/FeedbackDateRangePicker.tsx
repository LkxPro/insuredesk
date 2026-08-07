import { format } from "date-fns";
import { zhCN } from "date-fns/locale";
import { CalendarIcon, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface FeedbackDateRange {
  from?: Date;
  to?: Date;
}

function labelForRange(range: FeedbackDateRange) {
  if (!range.from) return "反馈时间";
  const from = format(range.from, "yyyy-MM-dd");
  return range.to ? `${from} 至 ${format(range.to, "yyyy-MM-dd")}` : `${from} 至 …`;
}

/** 两次日历单击完成一个范围；第二次完成后立即交给页面筛选。 */
export function FeedbackDateRangePicker({
  value,
  onChange,
}: {
  value: FeedbackDateRange;
  onChange: (range: FeedbackDateRange) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<FeedbackDateRange>(value);
  const hasRange = !!value.from || !!value.to;

  return (
    <div className="group relative">
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) setDraft(value);
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className={cn(
              "h-8 min-w-48 justify-start gap-2 pr-8 text-left font-normal",
              hasRange && "text-foreground",
            )}
            aria-label="反馈时间范围"
          >
            <CalendarIcon className="size-4 shrink-0" />
            <span className="truncate">{labelForRange(value)}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="range"
            selected={draft.from ? { from: draft.from, to: draft.to } : undefined}
            onSelect={(next) => {
              const range: FeedbackDateRange = next ? { from: next.from, to: next.to } : {};
              setDraft(range);
              if (range.from && range.to) {
                onChange(range.from <= range.to ? range : { from: range.to, to: range.from });
                setOpen(false);
              }
            }}
            locale={zhCN}
            numberOfMonths={2}
          />
          <p className="border-t px-3 py-2 text-xs text-muted-foreground">
            单击开始日期，再单击截止日期即可筛选
          </p>
        </PopoverContent>
      </Popover>
      {hasRange && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-0.5 top-0.5 size-7 rounded-full bg-background/70 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          aria-label="清除反馈时间范围"
          onClick={() => {
            setDraft({});
            onChange({});
          }}
        >
          <X />
        </Button>
      )}
    </div>
  );
}
