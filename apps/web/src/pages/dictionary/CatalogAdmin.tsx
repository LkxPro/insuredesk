import type { CatalogSchemas } from "@insuredesk/shared";
import { AlertCircle, Ban, CircleCheck, Pencil, Plus, Trash2 } from "lucide-react";
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

/**
 * 字典目录管理段, shared by the 渠道/类别/完结状态 catalogs: list with 已停用
 * 标注, create/rename/reorder dialog with schema error mapping, 停用/启用
 * toggle, and the delete dialog that surfaces the server's in-use refusal.
 * Each catalog is a `CatalogAdminConfig`: its tRPC hooks, wording, and input
 * schema — no behavior switches.
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
 * The structural slice of a catalog's tRPC namespace the section uses. Configs
 * pass the concrete `trpc.<catalog>` hooks so the wire stays typed end to end
 * — a config wired to the wrong namespace only compiles if the shapes match,
 * and the per-catalog smoke tests pin the namespace itself.
 */
export interface CatalogAdminHooks {
  useList(): {
    data: CatalogRow[] | undefined;
    isLoading: boolean;
    error: { message: string } | null;
  };
  useInvalidate(): () => void;
  useCreate(opts: { onSuccess: () => void }): MutationLike<{ name: string; displayOrder: number }>;
  useUpdate(opts: {
    onSuccess: () => void;
  }): MutationLike<{ id: string; name: string; displayOrder: number }>;
  useSetActive(opts: {
    onSuccess: (row: { active: boolean } | undefined) => void;
    onError: (error: { message: string }) => void;
  }): MutationLike<{ id: string; active: boolean }>;
  useDelete(opts: { onSuccess: () => void }): MutationLike<{ id: string }>;
}

export interface CatalogAdminConfig {
  /** Dialog field DOM id prefix（channel → channel-name / channel-order）. */
  idPrefix: string;
  /** 段标题（反馈渠道/客诉类别/完结状态）. */
  title: string;
  /** 目录项名词，进按钮、弹窗标题与操作回执（渠道/类别/完结状态）. */
  noun: string;
  /** 名称字段名词（渠道/类别/状态），与 shared schema 的报错措辞一致. */
  nameNoun: string;
  /** 段副标题：该目录被哪些表单消费、停用的语义. */
  subtitle: string;
  /** 空表引导文案. */
  emptyDescription: string;
  /** 新增/编辑弹窗说明：改名与排序的生效面. */
  dialogDescription: string;
  createInputSchema: CatalogSchemas["createInputSchema"];
  hooks: CatalogAdminHooks;
}

type Draft = { name: string; displayOrder: string };

const EMPTY_DRAFT: Draft = { name: "", displayOrder: "0" };

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
    setDraft(row ? { name: row.name, displayOrder: String(row.displayOrder) } : EMPTY_DRAFT);
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
    const parsed = config.createInputSchema.safeParse({
      name: draft.name,
      displayOrder: Number(draft.displayOrder),
    });
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
      update.mutate({ id: row.id, ...parsed.data });
    } else {
      create.mutate(parsed.data);
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

          <Field data-invalid={Boolean(errors.displayOrder)}>
            <FieldLabel htmlFor={`${config.idPrefix}-order`}>显示顺序</FieldLabel>
            <Input
              id={`${config.idPrefix}-order`}
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

  const setActive = config.hooks.useSetActive({
    onSuccess: (row) => {
      toast.success(row?.active ? `${config.noun}已启用` : `${config.noun}已停用`);
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  function openCreate() {
    setEditTarget(null);
    setEditorOpen(true);
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">{config.title}</h2>
          <p className="text-sm text-muted-foreground">{config.subtitle}</p>
        </div>
        <Button onClick={openCreate}>
          <Plus data-icon="inline-start" />
          新增{config.noun}
        </Button>
      </div>

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
                <TableHead>名称</TableHead>
                <TableHead>显示顺序</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="w-36">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.isLoading ? (
                [0, 1, 2, 3].map((row) => (
                  <TableRow key={row}>
                    <TableCell>
                      <Skeleton className="h-5 w-40" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-12" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-14" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-8 w-28" />
                    </TableCell>
                  </TableRow>
                ))
              ) : (list.data ?? []).length === 0 ? (
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
                (list.data ?? []).map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell>{row.displayOrder}</TableCell>
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
    </section>
  );
}
