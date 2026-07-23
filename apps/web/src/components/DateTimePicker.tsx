import { format, isValid, parse } from "date-fns";
import { zhCN } from "date-fns/locale";
import "imask/masked/date";
import MaskedRange from "imask/masked/range";
import { CalendarIcon, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import useIMask from "react-imask/esm/hook";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { isCompleteLocalDate, joinLocalDateTime, splitLocalDateTime } from "@/lib/local-date-time";

/**
 * Calendar + explicit 24-hour minute input. Controlled around a LOCAL datetime string:
 * complete `YYYY-MM-DDTHH:mm`, date-only `YYYY-MM-DDT`, time-only `THH:mm`, or
 * `""` when unset. The form validates the pair and owns conversion to an
 * absolute instant.
 */

const CALENDAR_START = new Date(1900, 0, 1);
const CALENDAR_END = new Date(2100, 11, 31);
const COMPLETE_SHORT_DATE = /^\d{2}-\d{2}-\d{2}$/;

function toShortDate(value: string): string {
  return isCompleteLocalDate(value) ? value.slice(2) : value;
}

/** Resolve YY in the nearest century, anchored to the current or selected year. */
function toLocalDate(value: string, referenceDate: Date): string {
  if (!COMPLETE_SHORT_DATE.test(value)) return value;
  const parsed = parse(value, "yy-MM-dd", referenceDate);
  return isValid(parsed) && format(parsed, "yy-MM-dd") === value
    ? format(parsed, "yyyy-MM-dd")
    : value;
}

export function DateTimePicker({
  id,
  value,
  onChange,
  datePickerAriaLabel = "打开日期选择器",
  timeAriaLabel = "时间",
  invalid = false,
}: {
  /** Base element id: the date input is `${id}-date`, the time input `${id}-time`. */
  id: string;
  /** Complete or temporarily partial local datetime string; ""/undefined = unset. */
  value: string | undefined;
  onChange: (value: string) => void;
  /** Accessible name for the button that opens the calendar. */
  datePickerAriaLabel?: string;
  /** Accessible name for the native time input. */
  timeAriaLabel?: string;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const parts = splitLocalDateTime(value);
  const selectedDate = isCompleteLocalDate(parts.date)
    ? new Date(`${parts.date}T00:00:00`)
    : undefined;
  const selectedYear = selectedDate?.getFullYear();
  const referenceYearRef = useRef(selectedYear ?? new Date().getFullYear());
  const referenceYear = selectedYear ?? referenceYearRef.current;
  const referenceDate = useMemo(() => new Date(referenceYear, 0, 1), [referenceYear]);
  const shortDate = toShortDate(parts.date);
  const timeMaskOptions = useMemo(
    () => ({
      mask: "HH:MM",
      lazy: true,
      eager: "append" as const,
      overwrite: true,
      blocks: {
        HH: {
          mask: MaskedRange,
          from: 0,
          to: 23,
          maxLength: 2,
        },
        MM: {
          mask: MaskedRange,
          from: 0,
          to: 59,
          maxLength: 2,
        },
      },
    }),
    [],
  );
  const dateMaskOptions = useMemo(
    () => ({
      mask: Date,
      pattern: "Y-`m-`d",
      lazy: true,
      eager: "append" as const,
      overwrite: true,
      autofix: true,
      min: CALENDAR_START,
      max: CALENDAR_END,
      blocks: {
        Y: {
          mask: MaskedRange,
          from: 0,
          to: 99,
          maxLength: 2,
        },
        m: {
          mask: MaskedRange,
          from: 1,
          to: 12,
          maxLength: 2,
        },
        d: {
          mask: MaskedRange,
          from: 1,
          to: 31,
          maxLength: 2,
        },
      },
      format: (date: Date | null) => (date ? format(date, "yy-MM-dd") : ""),
      parse: (maskedDate: string) => parse(maskedDate, "yy-MM-dd", referenceDate),
    }),
    [referenceDate],
  );
  const { ref: dateInputRef, setValue: setMaskedDate } = useIMask<HTMLInputElement>(
    dateMaskOptions,
    {
      defaultValue: shortDate,
      onAccept: (maskedDate) => {
        const nextDate = toLocalDate(maskedDate, referenceDate);
        if (nextDate !== parts.date) {
          onChange(joinLocalDateTime({ date: nextDate, time: parts.time }));
        }
      },
    },
  );
  const { ref: timeInputRef, setValue: setMaskedTime } = useIMask<HTMLInputElement>(
    timeMaskOptions,
    {
      defaultValue: parts.time,
      onAccept: (maskedTime) => {
        if (maskedTime !== parts.time) {
          onChange(joinLocalDateTime({ date: parts.date, time: maskedTime }));
        }
      },
    },
  );

  useEffect(() => {
    setMaskedDate(shortDate);
  }, [setMaskedDate, shortDate]);

  useEffect(() => {
    setMaskedTime(parts.time);
  }, [parts.time, setMaskedTime]);

  useEffect(() => {
    if (selectedYear !== undefined) {
      referenceYearRef.current = selectedYear;
    }
  }, [selectedYear]);

  return (
    <div className="@container/date-time w-fit max-w-full">
      <div className="grid grid-cols-[8rem_7rem_auto] items-center gap-2 @max-[18rem]/date-time:grid-cols-[8rem_auto]">
        <InputGroup className="w-32 @max-[18rem]/date-time:col-span-2">
          <InputGroupInput
            ref={dateInputRef}
            id={`${id}-date`}
            placeholder="YY-MM-DD"
            inputMode="numeric"
            autoComplete="off"
            aria-invalid={invalid}
          />
          <InputGroupAddon align="inline-end">
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger asChild>
                <InputGroupButton
                  size="icon-xs"
                  aria-label={datePickerAriaLabel}
                  aria-invalid={invalid}
                >
                  <CalendarIcon />
                </InputGroupButton>
              </PopoverTrigger>
              <PopoverContent className="w-auto overflow-hidden p-0" align="start">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  defaultMonth={selectedDate}
                  captionLayout="dropdown"
                  navLayout="after"
                  startMonth={CALENDAR_START}
                  endMonth={CALENDAR_END}
                  locale={zhCN}
                  formatters={{
                    formatMonthDropdown: (date) => format(date, "M月", { locale: zhCN }),
                  }}
                  onSelect={(date) => {
                    if (!date) return;
                    onChange(
                      joinLocalDateTime({
                        date: format(date, "yyyy-MM-dd"),
                        time: parts.time,
                      }),
                    );
                    setOpen(false);
                  }}
                />
              </PopoverContent>
            </Popover>
          </InputGroupAddon>
        </InputGroup>

        <Input
          ref={timeInputRef}
          id={`${id}-time`}
          type="text"
          inputMode="numeric"
          placeholder="HH:mm"
          autoComplete="off"
          aria-label={timeAriaLabel}
          aria-invalid={invalid}
          className="w-28 tabular-nums @max-[18rem]/date-time:col-start-1"
        />

        {value ? (
          <Button
            id={`${id}-clear`}
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0 text-muted-foreground"
            aria-label="清空时间"
            onClick={() => onChange("")}
          >
            <X />
          </Button>
        ) : (
          <span className="size-9 @max-[18rem]/date-time:hidden" aria-hidden="true" />
        )}
      </div>
    </div>
  );
}
