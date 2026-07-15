import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";
import { Calendar as CalendarIcon, X } from "lucide-react";

/**
 * 日期 + 时/分 picker. Controlled around a partial LOCAL datetime string
 * "YYYY-MM-DDTHH:mm" ("" = unset) — the submit handler owns the conversion
 * to an absolute instant, mirroring how feedbackTime is held until submit.
 */

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0"));
const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, minute) => String(minute).padStart(2, "0"));

function splitDateTime(value?: string) {
  if (!value) return { date: "", time: "" };
  const [date = "", time = ""] = value.split("T");
  return { date, time };
}

export function DateTimePicker({
  id,
  value,
  onChange,
  invalid = false,
}: {
  /** Base element id: the date button is `${id}-date`, the selects `${id}-hour` / `${id}-minute`. */
  id: string;
  /** Partial local datetime string "YYYY-MM-DDTHH:mm"; ""/undefined = unset. */
  value: string | undefined;
  onChange: (value: string) => void;
  invalid?: boolean;
}) {
  const parts = splitDateTime(value);
  const [selectedHour = "", selectedMinute = ""] = parts.time.split(":");
  const selectedDate = parts.date ? new Date(`${parts.date}T00:00:00`) : undefined;

  return (
    <div className="flex gap-2">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            id={`${id}-date`}
            type="button"
            variant="outline"
            aria-invalid={invalid}
            className={cn(
              "flex-1 justify-start text-left font-normal",
              !parts.date && "text-muted-foreground",
            )}
          >
            <CalendarIcon data-icon="inline-start" />
            {selectedDate ? format(selectedDate, "PPP", { locale: zhCN }) : "请选择日期"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={(date) => {
              if (!date) return;
              const nextDate = format(date, "yyyy-MM-dd");
              onChange(`${nextDate}T${selectedHour || "00"}:${selectedMinute || "00"}`);
            }}
          />
        </PopoverContent>
      </Popover>
      <Select
        value={selectedHour}
        onValueChange={(hour) => {
          if (!parts.date) return;
          onChange(`${parts.date}T${hour}:${selectedMinute || "00"}`);
        }}
        disabled={!parts.date}
      >
        <SelectTrigger id={`${id}-hour`} aria-invalid={invalid} className="w-20 shrink-0">
          <SelectValue placeholder="时" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {HOUR_OPTIONS.map((hour) => (
              <SelectItem key={hour} value={hour}>
                {hour} 时
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <Select
        value={selectedMinute}
        onValueChange={(minute) => {
          if (!parts.date) return;
          onChange(`${parts.date}T${selectedHour || "00"}:${minute}`);
        }}
        disabled={!parts.date}
      >
        <SelectTrigger id={`${id}-minute`} aria-invalid={invalid} className="w-20 shrink-0">
          <SelectValue placeholder="分" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {MINUTE_OPTIONS.map((minute) => (
              <SelectItem key={minute} value={minute}>
                {minute} 分
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
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
      ) : null}
    </div>
  );
}
