import type { AppRouter } from "@insuredesk/api";
import { type ShiftSegment, shiftTypeCreateInputSchema } from "@insuredesk/shared";
import type { inferRouterOutputs } from "@trpc/server";
import { AlertCircle, Pencil, Plus, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
import { trpc } from "@/lib/trpc";

type ShiftTypeRow = inferRouterOutputs<AppRouter>["shiftType"]["list"][number];

type Draft = {
  name: string;
  color: string;
  displayOrder: string;
  segments: ShiftSegment[];
};

const EMPTY_DRAFT: Draft = {
  name: "",
  color: "#3b82f6",
  displayOrder: "0",
  segments: [],
};

function ShiftTypeDialog({
  open,
  shift,
  onOpenChange,
}: {
  open: boolean;
  shift: ShiftTypeRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setDraft(
      shift
        ? {
            name: shift.name,
            color: shift.color,
            displayOrder: String(shift.displayOrder),
            segments: shift.segments.map((segment) => ({ ...segment })),
          }
        : EMPTY_DRAFT,
    );
    setErrors({});
  }, [open, shift]);

  const closeAfterSave = () => {
    toast.success(shift ? "班次已更新" : "班次已创建");
    utils.shiftType.list.invalidate();
    onOpenChange(false);
  };
  const create = trpc.shiftType.create.useMutation({ onSuccess: closeAfterSave });
  const update = trpc.shiftType.update.useMutation({ onSuccess: closeAfterSave });
  const pending = create.isPending || update.isPending;
  const mutationError = create.error ?? update.error;

  function setSegment(index: number, field: keyof ShiftSegment, value: string) {
    setDraft((current) => ({
      ...current,
      segments: current.segments.map((segment, segmentIndex) =>
        segmentIndex === index ? { ...segment, [field]: value } : segment,
      ),
    }));
  }

  function save() {
    const candidate = {
      name: draft.name,
      color: draft.color,
      displayOrder: Number(draft.displayOrder),
      segments: draft.segments,
    };
    const parsed = shiftTypeCreateInputSchema.safeParse(candidate);
    if (!parsed.success) {
      const nextErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".");
        if (!(key in nextErrors)) nextErrors[key] = issue.message;
      }
      setErrors(nextErrors);
      return;
    }
    setErrors({});
    if (shift) {
      update.mutate({ id: shift.id, ...parsed.data });
    } else {
      create.mutate(parsed.data);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{shift ? "编辑班次" : "新增班次"}</DialogTitle>
          <DialogDescription>配置显示名称、颜色、时段和在排班选择器中的顺序。</DialogDescription>
        </DialogHeader>

        <FieldGroup>
          <Field data-invalid={Boolean(errors.name)}>
            <FieldLabel htmlFor="shift-name">班次名称</FieldLabel>
            <Input
              id="shift-name"
              value={draft.name}
              aria-invalid={Boolean(errors.name)}
              onChange={(event) =>
                setDraft((current) => ({ ...current, name: event.target.value }))
              }
            />
            <FieldError>{errors.name}</FieldError>
          </Field>

          <Field data-invalid={Boolean(errors.color)}>
            <FieldLabel htmlFor="shift-color">班次颜色</FieldLabel>
            <div className="flex items-center gap-3">
              <Input
                id="shift-color"
                type="color"
                className="w-16 p-1"
                value={draft.color}
                aria-invalid={Boolean(errors.color)}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, color: event.target.value }))
                }
              />
              <Input
                aria-label="颜色值"
                value={draft.color}
                aria-invalid={Boolean(errors.color)}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, color: event.target.value }))
                }
              />
            </div>
            <FieldError>{errors.color}</FieldError>
          </Field>

          <Field data-invalid={Boolean(errors.displayOrder)}>
            <FieldLabel htmlFor="shift-order">显示顺序</FieldLabel>
            <Input
              id="shift-order"
              type="number"
              value={draft.displayOrder}
              aria-invalid={Boolean(errors.displayOrder)}
              onChange={(event) =>
                setDraft((current) => ({ ...current, displayOrder: event.target.value }))
              }
            />
            <FieldDescription>数字越小越靠前。</FieldDescription>
            <FieldError>{errors.displayOrder}</FieldError>
          </Field>

          <Field>
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col gap-1">
                <FieldLabel>工作时段</FieldLabel>
                <FieldDescription>可添加多个时段；不添加表示休息日。允许跨午夜。</FieldDescription>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    segments: [...current.segments, { start: "09:00", end: "18:00" }],
                  }))
                }
              >
                <Plus data-icon="inline-start" />
                添加时段
              </Button>
            </div>
            {draft.segments.length === 0 ? (
              <p className="text-sm text-muted-foreground">休息日（无时段）</p>
            ) : (
              <div className="flex flex-col gap-3">
                {draft.segments.map((segment, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: position is the segment identity in this ordered form
                  <div key={index} className="flex items-end gap-2">
                    <Field data-invalid={Boolean(errors[`segments.${index}.start`])}>
                      <FieldLabel htmlFor={`segment-${index}-start`}>开始时间</FieldLabel>
                      <Input
                        id={`segment-${index}-start`}
                        type="time"
                        value={segment.start}
                        aria-invalid={Boolean(errors[`segments.${index}.start`])}
                        onChange={(event) => setSegment(index, "start", event.target.value)}
                      />
                      <FieldError>{errors[`segments.${index}.start`]}</FieldError>
                    </Field>
                    <Field data-invalid={Boolean(errors[`segments.${index}.end`])}>
                      <FieldLabel htmlFor={`segment-${index}-end`}>结束时间</FieldLabel>
                      <Input
                        id={`segment-${index}-end`}
                        type="time"
                        value={segment.end}
                        aria-invalid={Boolean(errors[`segments.${index}.end`])}
                        onChange={(event) => setSegment(index, "end", event.target.value)}
                      />
                      <FieldError>{errors[`segments.${index}.end`]}</FieldError>
                    </Field>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`删除时段 ${index + 1}`}
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          segments: current.segments.filter(
                            (_, segmentIndex) => segmentIndex !== index,
                          ),
                        }))
                      }
                    >
                      <X />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </Field>
        </FieldGroup>

        {mutationError && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>保存失败</AlertTitle>
            <AlertDescription>{mutationError.message}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={pending}>
              取消
            </Button>
          </DialogClose>
          <Button type="button" onClick={save} disabled={pending}>
            {pending && <Spinner data-icon="inline-start" />}
            {pending ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteShiftTypeDialog({
  shift,
  onOpenChange,
}: {
  shift: ShiftTypeRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const remove = trpc.shiftType.delete.useMutation({
    onSuccess: () => {
      toast.success("班次已删除");
      utils.shiftType.list.invalidate();
      onOpenChange(false);
    },
  });
  return (
    <Dialog open={shift !== null} onOpenChange={(next) => !remove.isPending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>删除班次</DialogTitle>
          <DialogDescription>
            确定删除“{shift?.name}”吗？已有排班记录引用的班次不能删除。
          </DialogDescription>
        </DialogHeader>
        {remove.error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>删除失败</AlertTitle>
            <AlertDescription>{remove.error.message}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={remove.isPending}>
              取消
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            disabled={remove.isPending || !shift}
            onClick={() => shift && remove.mutate({ id: shift.id })}
          >
            {remove.isPending && <Spinner data-icon="inline-start" />}
            {remove.isPending ? "删除中…" : "确认删除"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ShiftTypesPage() {
  const list = trpc.shiftType.list.useQuery();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ShiftTypeRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ShiftTypeRow | null>(null);

  function openCreate() {
    setEditTarget(null);
    setEditorOpen(true);
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">班次管理</h1>
          <p className="text-sm text-muted-foreground">
            管理排班可选的班次名称、颜色和工作时段；零时段表示休息日。
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus data-icon="inline-start" />
          新增班次
        </Button>
      </div>

      {list.error ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>班次加载失败</AlertTitle>
          <AlertDescription>{list.error.message}</AlertDescription>
        </Alert>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>班次</TableHead>
                <TableHead>工作时段</TableHead>
                <TableHead>显示顺序</TableHead>
                <TableHead className="w-32">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.isLoading ? (
                [0, 1, 2, 3].map((row) => (
                  <TableRow key={row}>
                    <TableCell>
                      <Skeleton className="h-5 w-24" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-40" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-12" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-8 w-24" />
                    </TableCell>
                  </TableRow>
                ))
              ) : (list.data ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="p-0">
                    <Empty className="border-0">
                      <EmptyHeader>
                        <EmptyTitle>暂无班次定义</EmptyTitle>
                        <EmptyDescription>新增一个班次后即可用于排班。</EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  </TableCell>
                </TableRow>
              ) : (
                (list.data ?? []).map((shift) => (
                  <TableRow key={shift.id}>
                    <TableCell>
                      <div className="flex items-center gap-2 font-medium">
                        <span
                          role="img"
                          aria-label={`${shift.name}颜色`}
                          className="size-3 rounded-full border"
                          style={{ backgroundColor: shift.color }}
                        />
                        {shift.name}
                      </div>
                    </TableCell>
                    <TableCell>
                      {shift.segments.length === 0 ? (
                        <Badge variant="outline">休息日（无时段）</Badge>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {shift.segments.map((segment) => (
                            <Badge key={`${segment.start}-${segment.end}`} variant="secondary">
                              {segment.start}–{segment.end}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>{shift.displayOrder}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`编辑 ${shift.name}`}
                          onClick={() => {
                            setEditTarget(shift);
                            setEditorOpen(true);
                          }}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`删除 ${shift.name}`}
                          onClick={() => setDeleteTarget(shift)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <ShiftTypeDialog
        open={editorOpen}
        shift={editTarget}
        onOpenChange={(open) => {
          setEditorOpen(open);
          if (!open) setEditTarget(null);
        }}
      />
      <DeleteShiftTypeDialog
        shift={deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      />
    </div>
  );
}
