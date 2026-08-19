import type { CatalogSchemas } from "@insuredesk/shared";
import {
  AlertCircle,
  ArrowDownAZ,
  Ban,
  CircleCheck,
  GripVertical,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
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
import { type NameSortDir, sortByName } from "@/lib/name-sort";
import { toast } from "@/lib/toast";

/**
 * 字典目录管理面板, shared by the 渠道/类别/完结状态 catalogs: list with 已停用
 * 标注, create/rename dialog with schema error mapping, 停用/启用 toggle, the
 * delete dialog that surfaces the server's in-use refusal, drag/keyboard
 * reorder, and a name-sort preview that only overwrites the manual order on
 * explicit save. Each catalog is a `CatalogAdminConfig`: its tRPC hooks,
 * wording, and input schema — no behavior switches.
 */

interface CatalogRow {
  id: string;
  name: string;
  active: boolean;
  displayOrder: number;
}

interface MutationLike<Input> {
  mutate: (input: Input) => void;
  isPending: boolean;
  error: { message: string } | null;
}

/**
 * The structural slice of a catalog's tRPC namespace the panel uses.
 */
export interface CatalogAdminHooks {
  useList(): {
    data: CatalogRow[] | undefined;
    isLoading: boolean;
    error: { message: string } | null;
  };
  useInvalidate(): () => void;
  useCreate(opts: { onSuccess: () => void }): MutationLike<{ name: string; displayOrder?: number }>;
  useUpdate(opts: {
    onSuccess: () => void;
  }): MutationLike<{ id: string; name: string; displayOrder?: number }>;
  useSetActive(opts: {
    onSuccess: (row: { active: boolean } | undefined) => void;
    onError: (error: { message: string }) => void;
  }): MutationLike<{ id: string; active: boolean }>;
  useReorder(opts: {
    onError: (error: { message: string }) => void;
    onSettled: () => void;
  }): MutationLike<{ ids: string[] }>;
  useDelete(opts: { onSuccess: () => void }): MutationLike<{ id: string }>;
}

export interface CatalogAdminConfig {
  /** Dialog field DOM id prefix（channel → channel-name）. */
  idPrefix: string;
  /** 目录标题（反馈渠道/客诉类别/完结状态）. */
  title: string;
  /** 目录项名词，进按钮、弹窗标题与操作回执（渠道/类别/完结状态）. */
  noun: string;
  /** 名称字段名词（渠道/类别/状态），与 shared schema 的报错措辞一致. */
  nameNoun: string;
  /** 目录副标题：该目录被哪些表单消费、停用的语义. */
  subtitle: string;
  /** 空表引导文案. */
  emptyDescription: string;
  /** 新增/编辑弹窗说明：改名的生效面. */
  dialogDescription: string;
  createInputSchema: CatalogSchemas["createInputSchema"];
  hooks: CatalogAdminHooks;
}

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
  const invalidate = config.hooks.useInvalidate();
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setDraft(row ? { name: row.name } : EMPTY_DRAFT);
    setErrors({});
  }, [open, row]);

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

export function CatalogAdmin({ config }: { config: CatalogAdminConfig }) {
  const list = config.hooks.useList();
  const invalidate = config.hooks.useInvalidate();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<CatalogRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CatalogRow | null>(null);

  const [localRows, setLocalRows] = useState<CatalogRow[] | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [sortMode, setSortMode] = useState<NameSortDir | "manual">("manual");

  useEffect(() => {
    if (list.data) setLocalRows(null);
  }, [list.data]);

  const rows = localRows ?? list.data ?? [];
  const preview = sortMode === "manual" ? null : sortByName(rows, sortMode);
  const viewRows = preview ?? rows;

  const setActive = config.hooks.useSetActive({
    onSuccess: (row) => {
      toast.success(row?.active ? `${config.noun}已启用` : `${config.noun}已停用`);
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const reorder = config.hooks.useReorder({
    onError: (error) => toast.error(error.message),
    onSettled: () => invalidate(),
  });

  function applyOrder(next: CatalogRow[]) {
    setLocalRows(next);
    reorder.mutate({ ids: next.map((row) => row.id) });
  }

  function moveRow(from: number, to: number) {
    if (to < 0 || to >= rows.length || from === to) return;
    const next = [...rows];
    const moved = next.splice(from, 1)[0];
    if (!moved) return;
    next.splice(to, 0, moved);
    applyOrder(next);
  }

  function savePreview() {
    if (!preview) return;
    applyOrder(preview);
    setSortMode("manual");
    toast.success(`${config.noun}顺序已保存`);
  }

  function openCreate() {
    setEditTarget(null);
    setEditorOpen(true);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          拖拽行首手柄调整顺序，顺序即表单下拉的呈现顺序。
        </p>
        <div className="flex items-center gap-2">
          <Select
            value={sortMode}
            onValueChange={(value) => setSortMode(value as NameSortDir | "manual")}
          >
            <SelectTrigger size="sm" className="w-44" aria-label="排序方式">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="manual">手动排序</SelectItem>
              <SelectItem value="asc">名称 A→Z（拼音）</SelectItem>
              <SelectItem value="desc">名称 Z→A（拼音）</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={openCreate}>
            <Plus data-icon="inline-start" />
            新增{config.noun}
          </Button>
        </div>
      </div>

      {preview && (
        <Alert>
          <ArrowDownAZ />
          <AlertTitle>按名称{sortMode === "asc" ? "升序" : "降序"}预览中</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>拖拽已锁定；保存后才会替换手动顺序。</span>
            <span className="flex items-center gap-2">
              <Button size="sm" onClick={savePreview} disabled={reorder.isPending}>
                保存此顺序
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSortMode("manual")}>
                取消
              </Button>
            </span>
          </AlertDescription>
        </Alert>
      )}

      {list.error ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>{config.noun}加载失败</AlertTitle>
          <AlertDescription>{list.error.message}</AlertDescription>
        </Alert>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>名称</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="w-36">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.isLoading ? (
                [0, 1, 2, 3].map((row) => (
                  <TableRow key={row}>
                    <TableCell colSpan={4}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : viewRows.length === 0 ? (
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
                viewRows.map((row, index) => (
                  <TableRow
                    key={row.id}
                    draggable={preview === null}
                    onDragStart={(event) => {
                      if (preview !== null) return;
                      event.dataTransfer.effectAllowed = "move";
                      setDragIndex(index);
                    }}
                    onDragOver={(event) => {
                      if (preview !== null) return;
                      event.preventDefault();
                      setOverIndex(index);
                    }}
                    onDrop={(event) => {
                      if (preview !== null) return;
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
                      dragIndex === index && preview === null ? "opacity-40" : "",
                      preview === null &&
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
                        disabled={preview !== null}
                        className="cursor-grab text-muted-foreground active:cursor-grabbing"
                        onKeyDown={(event) => {
                          if (preview !== null) return;
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
