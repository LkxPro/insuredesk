const COMPLETE_LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const COMPLETE_LOCAL_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export interface LocalDateTimeParts {
  date: string;
  time: string;
}

/**
 * UI-only local datetime shape. Besides a complete `YYYY-MM-DDTHH:mm`, the
 * form may temporarily hold `YYYY-MM-DDT` or `THH:mm` while the user fills the
 * two controls in either order.
 */
export function splitLocalDateTime(value?: string): LocalDateTimeParts {
  if (!value) return { date: "", time: "" };
  const [date = "", time = ""] = value.split("T");
  return { date, time };
}

export function joinLocalDateTime({ date, time }: LocalDateTimeParts): string {
  return date || time ? `${date}T${time}` : "";
}

export function isCompleteLocalDate(value: string): boolean {
  if (!COMPLETE_LOCAL_DATE.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const parsed = new Date(`${value}T00:00:00`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.getFullYear() === year &&
    parsed.getMonth() === month - 1 &&
    parsed.getDate() === day
  );
}

export function isCompleteLocalTime(value: string): boolean {
  return COMPLETE_LOCAL_TIME.test(value);
}

export function isCompleteLocalDateTime(value: string): boolean {
  const { date, time } = splitLocalDateTime(value);
  return (
    isCompleteLocalDate(date) &&
    isCompleteLocalTime(time) &&
    !Number.isNaN(new Date(value).getTime())
  );
}

export function isPartialLocalDateTime(value: string): boolean {
  return value !== "" && !isCompleteLocalDateTime(value);
}

export function localDateTimeToIso(value: string): string | null {
  if (!value) return null;
  if (!isCompleteLocalDateTime(value)) {
    throw new RangeError("日期和时间必须完整填写");
  }
  return new Date(value).toISOString();
}
