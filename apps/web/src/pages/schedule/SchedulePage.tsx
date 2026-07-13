import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { CHANNELS, SHIFTS, SHIFT_LABELS, SHIFT_TIMES, type Shift } from "@insuredesk/shared";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";
import {
  AlertCircle,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Plus,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

/**
 * 排班配置: one day at a time, a 渠道 × 班次 grid of on-duty people.
 * schedule.view opens the page (route-guarded); add/remove are shown only
 * with schedule.edit — the API re-checks regardless. This roster is what
 * 按排班自动分配 draws its candidates from, so the grid mirrors exactly how
 * that algorithm matches: date + channel + shift window.
 */

/** A grid cell address — where a new duty entry goes. */
type CellTarget = { shift: Shift; channel: (typeof CHANNELS)[number] };

function toDateString(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

function AddDutyDialog({
  date,
  target,
  takenUserIds,
  onOpenChange,
}: {
  date: string;
  target: CellTarget | null;
  /** Users already on the target cell — greyed out, the server would 409 anyway. */
  takenUserIds: ReadonlySet<string>;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const [userId, setUserId] = useState("");
  const [remark, setRemark] = useState("");
  const open = target !== null;

  // A fresh dialog starts unselected — a leftover pick from the previous cell
  // must never be one click away from confirming.
  useEffect(() => {
    if (open) {
      setUserId("");
      setRemark("");
    }
  }, [open]);

  const options = trpc.schedule.dutyUserOptions.useQuery(undefined, { enabled: open });

  const create = trpc.schedule.create.useMutation({
    onSuccess: (result) => {
      toast.success(`已添加值班人 ${result.userName}`);
      utils.schedule.list.invalidate();
      onOpenChange(false);
    },
  });

  function confirm() {
    if (!target || !userId) {
      return;
    }
    create.mutate({
      date,
      shift: target.shift,
      channel: target.channel,
      userId,
      remark: remark.trim() || null,
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !create.isPending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>添加值班人</DialogTitle>
          <DialogDescription>
            {target &&
              `${date} · ${SHIFT_LABELS[target.shift]}（${SHIFT_TIMES[target.shift].startTime}–${SHIFT_TIMES[target.shift].endTime}） · ${target.channel}渠道`}
          </DialogDescription>
        </DialogHeader>

        <Field>
          <FieldLabel htmlFor="duty-user">值班人</FieldLabel>
          <Select value={userId} onValueChange={setUserId}>
            <SelectTrigger id="duty-user" className="w-full" disabled={options.isLoading}>
              <SelectValue placeholder="请选择值班人" />
            </SelectTrigger>
            <SelectContent>
              {(options.data ?? []).map((user) => (
                <SelectItem key={user.id} value={user.id} disabled={takenUserIds.has(user.id)}>
                  {user.name}
                  {takenUserIds.has(user.id) && "（已在此班次）"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabel htmlFor="duty-remark">备注（可选）</FieldLabel>
          <Input
            id="duty-remark"
            value={remark}
            maxLength={200}
            onChange={(event) => setRemark(event.target.value)}
            placeholder="如：顶班、新人带教"
          />
        </Field>

        {create.error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>添加失败</AlertTitle>
            <AlertDescription>{create.error.message}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={create.isPending}>
              取消
            </Button>
          </DialogClose>
          <Button type="button" onClick={confirm} disabled={create.isPending || !userId}>
            {create.isPending && <Spinner data-icon="inline-start" />}
            {create.isPending ? "提交中…" : "确认"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SchedulePage() {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission("schedule.edit");
  const utils = trpc.useUtils();

  const [date, setDate] = useState(() => toDateString(new Date()));
  const [addTarget, setAddTarget] = useState<CellTarget | null>(null);

  const listQuery = trpc.schedule.list.useQuery({ date });

  const remove = trpc.schedule.delete.useMutation({
    onSuccess: () => {
      toast.success("已移除值班人");
      utils.schedule.list.invalidate();
    },
    onError: (error) => {
      toast.error(`移除失败：${error.message}`);
      utils.schedule.list.invalidate();
    },
  });

  const entries = listQuery.data ?? [];
  const cellEntries = (target: CellTarget) =>
    entries.filter((entry) => entry.shift === target.shift && entry.channel === target.channel);

  function shiftDate(days: number) {
    const next = new Date(`${date}T00:00:00`);
    next.setDate(next.getDate() + days);
    setDate(toDateString(next));
  }

  const selectedDate = new Date(`${date}T00:00:00`);
  const isToday = date === toDateString(new Date());

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">排班配置</h1>
          <p className="text-sm text-muted-foreground">
            按日期、班次、渠道配置值班人员；「按排班自动分配」从当日在岗值班人中选人。
          </p>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="前一天"
            onClick={() => shiftDate(-1)}
          >
            <ChevronLeft />
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="min-w-40 font-normal">
                <CalendarIcon data-icon="inline-start" />
                {format(selectedDate, "PPP EEE", { locale: zhCN })}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={(picked) => picked && setDate(toDateString(picked))}
              />
            </PopoverContent>
          </Popover>
          <Button variant="outline" size="icon-sm" aria-label="后一天" onClick={() => shiftDate(1)}>
            <ChevronRight />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={isToday}
            onClick={() => setDate(toDateString(new Date()))}
          >
            今天
          </Button>
        </div>
      </div>

      {listQuery.error ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>排班加载失败</AlertTitle>
          <AlertDescription>{listQuery.error.message}</AlertDescription>
        </Alert>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">渠道</TableHead>
                {SHIFTS.map((shift) => (
                  <TableHead key={shift}>
                    {SHIFT_LABELS[shift]}
                    <span className="ml-2 font-normal text-muted-foreground">
                      {SHIFT_TIMES[shift].startTime}–{SHIFT_TIMES[shift].endTime}
                    </span>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {CHANNELS.map((channel) => (
                <TableRow key={channel} className="hover:bg-transparent">
                  <TableCell className="font-medium">{channel}</TableCell>
                  {SHIFTS.map((shift) => {
                    const target: CellTarget = { shift, channel };
                    const cell = cellEntries(target);
                    return (
                      <TableCell key={shift} className="align-top">
                        <div className="flex flex-wrap items-center gap-1.5 py-1">
                          {listQuery.isLoading ? (
                            <Skeleton className="h-6 w-24" />
                          ) : (
                            <>
                              {cell.length === 0 && !canEdit && (
                                <span className="text-sm text-muted-foreground">无排班</span>
                              )}
                              {cell.map((entry) => (
                                <Badge
                                  key={entry.id}
                                  variant="secondary"
                                  className={cn(
                                    "gap-1 pr-1 font-normal",
                                    !entry.userActive && "opacity-60",
                                  )}
                                  title={entry.remark ?? undefined}
                                >
                                  {entry.userName}
                                  {!entry.userActive && "（已停用）"}
                                  {canEdit && (
                                    <button
                                      type="button"
                                      aria-label={`移除 ${entry.userName}`}
                                      className="rounded-sm p-0.5 hover:bg-muted-foreground/20"
                                      disabled={remove.isPending}
                                      onClick={() => remove.mutate({ id: entry.id })}
                                    >
                                      <X className="size-3" />
                                    </button>
                                  )}
                                </Badge>
                              ))}
                              {canEdit && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2 text-muted-foreground"
                                  onClick={() => setAddTarget(target)}
                                >
                                  <Plus data-icon="inline-start" />
                                  添加
                                </Button>
                              )}
                            </>
                          )}
                        </div>
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {canEdit && (
        <AddDutyDialog
          date={date}
          target={addTarget}
          takenUserIds={
            new Set(addTarget ? cellEntries(addTarget).map((entry) => entry.userId) : [])
          }
          onOpenChange={(open) => {
            if (!open) setAddTarget(null);
          }}
        />
      )}
    </div>
  );
}
