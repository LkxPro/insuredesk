// 原型（可丢弃）：三个排序变体共用的抽屉家具（数据、弹窗、表格壳）。
// 从 ../CatalogAdmin.tsx 复制，排序相关的部分由变体自己掌控。
import { AlertCircle, Ban, CircleCheck, GripVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
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
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
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
import { toast } from "@/lib/toast";
import type { CatalogAdminConfig } from "../CatalogAdmin";

export interface CatalogRow {
  id: string;
  name: string;
  active: boolean;
  displayOrder: number;
}

export function usePanel(config: CatalogAdminConfig) {
  const list = config.hooks.useList();
  const invalidate = config.hooks.useInvalidate();
  const [localRows, setLocalRows] = useState<CatalogRow[] | null>(null);

  useEffect(() => {
    if (list.data) setLocalRows(null);
  }, [list.data]);

  const reorder = config.hooks.useReorder({
    onError: (error) => toast.error(error.message),
    onSettled: () => invalidate(),
  });

  function moveRows(next: CatalogRow[]) {
    setLocalRows(next);
    reorder.mutate({ ids: next.map((row) => row.id) });
  }

  return {
    list,
    rows: localRows ?? list.data ?? [],
    moveRows,
    reorderPending: reorder.isPending,
  };
}

export type Panel = ReturnType<typeof usePanel>;

type Draft = { name: string };

const EMPTY_DRAFT: Draft = { name: "" };

function CatalogDialog({
  config,
  open,
  row,
  onOpenChange,
}: {
  config: CatalogAdminConfig;
  open: boolean;
  row: CatalogRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setDraft(row ? { name: row.name } : EMPTY_DRAFT);
    setErrors({});
  }, [open, row]);

  const invalidate = config.hooks.useInvalidate();
  const closeAfterSave = () => {
    toast.success(row ? `${config.noun}已更新` : `${config.noun}已创建`);
    invalidate();
    onOpenChange(false);
  };
  const create = config.hooks.useCreate({ onSuccess: closeAfterSave });
  const update = config.hooks.useUpdate({ onSuccess: closeAfterSave });
  const pending = create.isPending || update.isPending;
  const mutationError = create.error ?? update.error;

  function save() {
    const parsed = config.createInputSchema.safeParse({ name: draft.name });
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
    if (row) {
      update.mutate({ id: row.id, name: parsed.data.name });
    } else {
      create.mutate({ name: parsed.data.name });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{row ? `编辑${config.noun}` : `新增${config.noun}`}</DialogTitle>
          <DialogDescription>{config.dialogDescription}</DialogDescription>
        </DialogHeader>

        <FieldGroup>
          <Field data-invalid={Boolean(errors.name)}>
            <FieldLabel htmlFor={`${config.idPrefix}-name`}>{config.nameNoun}名称</FieldLabel>
            <Input
              id={`${config.idPrefix}-name`}
              value={draft.name}
              aria-invalid={Boolean(errors.name)}
              onChange={(event) =>
                setDraft((current) => ({ ...current, name: event.target.value }))
              }
            />
            <FieldError>{errors.name}</FieldError>
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

function DeleteCatalogDialog({
  config,
  row,
  onOpenChange,
}: {
  config: CatalogAdminConfig;
  row: CatalogRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const invalidate = config.hooks.useInvalidate();
  const remove = config.hooks.useDelete({
    onSuccess: () => {
      toast.success(`${config.noun}已删除`);
      invalidate();
      onOpenChange(false);
    },
  });
  return (
    <Dialog open={row !== null} onOpenChange={(next) => !remove.isPending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>删除{config.noun}</DialogTitle>
          <DialogDescription>
            确定删除“{row?.name}”吗？已被工单使用的{config.noun}不能删除，只能停用。
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
            disabled={remove.isPending || !row}
            onClick={() => row && remove.mutate({ id: row.id })}
          >
            {remove.isPending && <Spinner data-icon="inline-start" />}
            {remove.isPending ? "删除中…" : "确认删除"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PanelShell({
  config,
  panel,
  rows,
  dragEnabled,
  hint,
  tag,
  toolbarExtra,
  banner,
  nameHead,
}: {
  config: CatalogAdminConfig;
  panel: Panel;
  rows: CatalogRow[];
  dragEnabled: boolean;
  hint: string;
  tag: string;
  toolbarExtra?: ReactNode;
  banner?: ReactNode;
  nameHead?: ReactNode;
}) {
  const invalidate = config.hooks.useInvalidate();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<CatalogRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CatalogRow | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const setActive = config.hooks.useSetActive({
    onSuccess: (row) => {
      toast.success(row?.active ? `${config.noun}已启用` : `${config.noun}已停用`);
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  function moveRow(from: number, to: number) {
    if (to < 0 || to >= rows.length || from === to) return;
    const next = [...rows];
    const moved = next.splice(from, 1)[0];
    if (!moved) return;
    next.splice(to, 0, moved);
    panel.moveRows(next);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="border-amber-500/60 text-amber-600">
          原型
        </Badge>
        <span className="text-xs text-muted-foreground">{tag}</span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">{hint}</p>
        <div className="flex items-center gap-2">
          {toolbarExtra}
          <Button
            onClick={() => {
              setEditTarget(null);
              setEditorOpen(true);
            }}
          >
            <Plus data-icon="inline-start" />
            新增{config.noun}
          </Button>
        </div>
      </div>

      {banner}

      {panel.list.error ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>{config.noun}加载失败</AlertTitle>
          <AlertDescription>{panel.list.error.message}</AlertDescription>
        </Alert>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>{nameHead ?? "名称"}</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="w-36">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {panel.list.isLoading ? (
                [0, 1, 2, 3].map((row) => (
                  <TableRow key={row}>
                    <TableCell colSpan={4}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="p-0">
                    <Empty className="border-0">
                      <EmptyHeader>
                        <EmptyTitle>暂无{config.title}</EmptyTitle>
                        <EmptyDescription>{config.emptyDescription}</EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row, index) => (
                  <TableRow
                    key={row.id}
                    draggable={dragEnabled}
                    onDragStart={(event) => {
                      if (!dragEnabled) return;
                      event.dataTransfer.effectAllowed = "move";
                      setDragIndex(index);
                    }}
                    onDragOver={(event) => {
                      if (!dragEnabled) return;
                      event.preventDefault();
                      setOverIndex(index);
                    }}
                    onDrop={(event) => {
                      if (!dragEnabled) return;
                      event.preventDefault();
                      if (dragIndex !== null) moveRow(dragIndex, index);
                      setDragIndex(null);
                      setOverIndex(null);
                    }}
                    onDragEnd={() => {
                      setDragIndex(null);
                      setOverIndex(null);
                    }}
                    className={[
                      dragEnabled && dragIndex === index ? "opacity-40" : "",
                      dragEnabled &&
                      overIndex === index &&
                      dragIndex !== null &&
                      dragIndex !== index
                        ? "bg-accent"
                        : "",
                    ].join(" ")}
                  >
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`排序 ${row.name}，方向键上下移动`}
                        disabled={!dragEnabled}
                        className="cursor-grab text-muted-foreground active:cursor-grabbing"
                        onKeyDown={(event) => {
                          if (!dragEnabled) return;
                          if (event.key === "ArrowUp") {
                            event.preventDefault();
                            moveRow(index, index - 1);
                          }
                          if (event.key === "ArrowDown") {
                            event.preventDefault();
                            moveRow(index, index + 1);
                          }
                        }}
                      >
                        <GripVertical />
                      </Button>
                    </TableCell>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell>
                      {row.active ? (
                        <Badge variant="secondary">启用</Badge>
                      ) : (
                        <Badge variant="outline">已停用</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`编辑 ${row.name}`}
                          onClick={() => {
                            setEditTarget(row);
                            setEditorOpen(true);
                          }}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`${row.active ? "停用" : "启用"} ${row.name}`}
                          disabled={setActive.isPending}
                          onClick={() => setActive.mutate({ id: row.id, active: !row.active })}
                        >
                          {row.active ? <Ban /> : <CircleCheck />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`删除 ${row.name}`}
                          onClick={() => setDeleteTarget(row)}
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

      <CatalogDialog
        config={config}
        open={editorOpen}
        row={editTarget}
        onOpenChange={(open) => {
          setEditorOpen(open);
          if (!open) setEditTarget(null);
        }}
      />
      <DeleteCatalogDialog
        config={config}
        row={deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      />
    </div>
  );
}
