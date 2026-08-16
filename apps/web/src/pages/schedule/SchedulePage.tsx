import type { AppRouter } from "@insuredesk/api";
import type { inferRouterOutputs } from "@trpc/server";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { zhCN } from "date-fns/locale";
import { AlertCircle, CalendarDays, Trash2 } from "lucide-react";
import { memo, useCallback, useMemo, useState } from "react";
import type { DateRange } from "react-day-picker";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/lib/toast";
import { trpc } from "@/lib/trpc";

type ScheduleGrid = inferRouterOutputs<AppRouter>["schedule"]["list"];
type ScheduleEntry = ScheduleGrid["entries"][number];
type ShiftOption = ScheduleGrid["shifts"][number];
type Preset = "month" | "week" | "previous-month" | "next-month" | "custom";

type VisibleRange = { start: Date; end: Date };

function monthRange(date: Date): VisibleRange {
  return { start: startOfMonth(date), end: endOfMonth(date) };
}

function presetRange(preset: Exclude<Preset, "custom">, today = new Date()): VisibleRange {
  if (preset === "week") {
    return {
      start: startOfWeek(today, { weekStartsOn: 1 }),
      end: endOfWeek(today, { weekStartsOn: 1 }),
    };
  }
  if (preset === "previous-month") return monthRange(addMonths(today, -1));
  if (preset === "next-month") return monthRange(addMonths(today, 1));
  return monthRange(today);
}

function dateString(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

function segmentsLabel(shift: Pick<ShiftOption, "segments">): string {
  if (shift.segments.length === 0) return "休息日";
  return shift.segments.map((segment) => `${segment.start}–${segment.end}`).join(" / ");
}

function contrastColor(hex: string): "#111827" | "#ffffff" {
  const red = Number.parseInt(hex.slice(1, 3), 16);
  const green = Number.parseInt(hex.slice(3, 5), 16);
  const blue = Number.parseInt(hex.slice(5, 7), 16);
  return red * 299 + green * 587 + blue * 114 > 155000 ? "#111827" : "#ffffff";
}

function ShiftVisual({ entry }: { entry: ScheduleEntry | undefined }) {
  return (
    <span
      className="flex h-8 min-w-16 items-center justify-center rounded-md px-2 text-xs font-medium"
      style={
        entry
          ? { backgroundColor: entry.shiftColor, color: contrastColor(entry.shiftColor) }
          : undefined
      }
    >
      {entry?.shiftName ?? "—"}
    </span>
  );
}

const NO_SHIFTS: ShiftOption[] = [];

const ScheduleCell = memo(function ScheduleCell({
  date,
  user,
  entry,
  shifts,
  editable,
  pending,
  onSet,
  onClear,
}: {
  date: string;
  user: ScheduleGrid["users"][number];
  entry: ScheduleEntry | undefined;
  shifts: ShiftOption[];
  editable: boolean;
  pending: boolean;
  onSet: (userId: string, date: string, shiftId: string) => void;
  onClear: (entry: ScheduleEntry) => void;
}) {
  const tooltip = entry
    ? `${entry.shiftName} · ${segmentsLabel({ segments: entry.shiftSegments })}`
    : "未排班";

  if (!editable || (!user.active && !entry)) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div role="img" aria-label={`${user.name} ${date}：${entry?.shiftName ?? "未排班"}`}>
            <ShiftVisual entry={entry} />
          </div>
        </TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className="h-auto p-0"
                aria-label={`${user.active ? "设置" : "清除"} ${user.name} ${date} 排班：${entry?.shiftName ?? "未排班"}`}
                disabled={pending}
              >
                <ShiftVisual entry={entry} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {user.active && (
                <DropdownMenuGroup>
                  {shifts.map((shift) => (
                    <DropdownMenuItem
                      key={shift.id}
                      onSelect={() => onSet(user.id, date, shift.id)}
                    >
                      <span
                        className="size-3 rounded-sm"
                        style={{ backgroundColor: shift.color }}
                        aria-hidden="true"
                      />
                      {shift.name} {segmentsLabel(shift)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              )}
              {entry && (
                <>
                  {user.active && <DropdownMenuSeparator />}
                  <DropdownMenuGroup>
                    <DropdownMenuItem variant="destructive" onSelect={() => onClear(entry)}>
                      <Trash2 />
                      清除排班
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
});

export function SchedulePage() {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission("schedule.edit");
  const utils = trpc.useUtils();
  const [preset, setPreset] = useState<Preset>("month");
  const [range, setRange] = useState<VisibleRange>(() => presetRange("month"));
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [pendingCell, setPendingCell] = useState<string | null>(null);

  const queryInput = { startDate: dateString(range.start), endDate: dateString(range.end) };
  const grid = trpc.schedule.list.useQuery(queryInput);
  const { mutate: createSchedule } = trpc.schedule.create.useMutation({
    onSuccess: () => {
      toast.success("排班已更新");
      utils.schedule.list.invalidate();
      setPendingCell(null);
    },
    onError: (error) => {
      toast.error(`排班更新失败：${error.message}`);
      setPendingCell(null);
    },
  });
  const { mutate: removeSchedule } = trpc.schedule.delete.useMutation({
    onSuccess: () => {
      toast.success("排班已清除");
      utils.schedule.list.invalidate();
      setPendingCell(null);
    },
    onError: (error) => {
      toast.error(`排班清除失败：${error.message}`);
      setPendingCell(null);
    },
  });

  const dates = useMemo(
    () =>
      eachDayOfInterval({ start: range.start, end: range.end }).map((date) => ({
        day: format(date, "yyyy-MM-dd"),
        dayOfMonth: format(date, "dd"),
        weekday: format(date, "EEE", { locale: zhCN }),
      })),
    [range],
  );
  const entries = grid.data?.entries ?? [];
  const entryByCell = useMemo(
    () => new Map(entries.map((entry) => [`${entry.userId}:${entry.date}`, entry])),
    [entries],
  );

  function choosePreset(value: string) {
    if (!value || value === "custom") return;
    const nextPreset = value as Exclude<Preset, "custom">;
    setPreset(nextPreset);
    setRange(presetRange(nextPreset));
  }

  function chooseCustom(next: DateRange | undefined) {
    if (!next?.from || !next.to) return;
    setPreset("custom");
    setRange({ start: next.from, end: next.to });
    setCalendarOpen(false);
  }

  const setShift = useCallback(
    (userId: string, date: string, shiftId: string) => {
      setPendingCell(`${userId}:${date}`);
      createSchedule({ date, userId, shiftId, remark: null });
    },
    [createSchedule],
  );

  const clearShift = useCallback(
    (entry: ScheduleEntry) => {
      setPendingCell(`${entry.userId}:${entry.date}`);
      removeSchedule({ id: entry.id });
    },
    [removeSchedule],
  );

  return (
    <div className="flex w-full max-w-full min-w-0 flex-1 flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">排班表</h1>
          <p className="text-sm text-muted-foreground">
            行为客服人员、列为日期；自动分配只会选择当前时段在岗的人员。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={preset === "custom" ? "" : preset}
            onValueChange={choosePreset}
          >
            <ToggleGroupItem value="month">本月</ToggleGroupItem>
            <ToggleGroupItem value="week">本周</ToggleGroupItem>
            <ToggleGroupItem value="previous-month">上月</ToggleGroupItem>
            <ToggleGroupItem value="next-month">下月</ToggleGroupItem>
          </ToggleGroup>
          <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
            <PopoverTrigger asChild>
              <Button variant={preset === "custom" ? "default" : "outline"} size="sm">
                <CalendarDays data-icon="inline-start" />
                自定义日期范围
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="range"
                numberOfMonths={2}
                selected={{ from: range.start, to: range.end }}
                onSelect={chooseCustom}
                locale={zhCN}
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        {format(range.start, "yyyy年M月d日", { locale: zhCN })} –
        {format(range.end, "yyyy年M月d日", { locale: zhCN })}
      </p>

      {grid.error ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>排班加载失败</AlertTitle>
          <AlertDescription>{grid.error.message}</AlertDescription>
        </Alert>
      ) : grid.isLoading ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((row) => (
            <Skeleton key={row} className="h-12 w-full" />
          ))}
        </div>
      ) : grid.data?.users.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>暂无可排班人员</EmptyTitle>
            <EmptyDescription>启用客服账号后即可开始排班。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="max-w-full min-w-0 rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 min-w-36 bg-background">客服人员</TableHead>
                {dates.map(({ day, dayOfMonth, weekday }) => (
                  <TableHead key={day} className="min-w-20 text-center">
                    <span className="flex flex-col gap-0.5">
                      <span>{dayOfMonth}</span>
                      <span className="text-xs font-normal text-muted-foreground">{weekday}</span>
                    </span>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {grid.data?.users.map((user) => (
                <TableRow key={user.id} className="hover:bg-transparent">
                  <TableCell className="sticky left-0 bg-background">
                    <span className="flex flex-col gap-0.5">
                      <span className="font-medium">{user.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {user.active ? user.username : `${user.username} · 已停用`}
                      </span>
                    </span>
                  </TableCell>
                  {dates.map(({ day }) => {
                    const cell = `${user.id}:${day}`;
                    const entry = entryByCell.get(cell);
                    return (
                      <TableCell key={day} className="p-1.5">
                        <ScheduleCell
                          date={day}
                          user={user}
                          entry={entry}
                          shifts={grid.data?.shifts ?? NO_SHIFTS}
                          editable={canEdit}
                          pending={pendingCell === cell}
                          onSet={setShift}
                          onClear={clearShift}
                        />
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
