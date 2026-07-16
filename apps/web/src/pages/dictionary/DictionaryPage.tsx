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
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
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
import type { AppRouter } from "@insuredesk/api";
import { channelCreateInputSchema, ticketCategoryCreateInputSchema } from "@insuredesk/shared";
import type { inferRouterOutputs } from "@trpc/server";
import { AlertCircle, Ban, CircleCheck, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

/**
 * 渠道与类别: the catalog management page behind dictionary.manage. 反馈渠道
 * and 客诉类别 render as sibling sections with the same lifecycle. 建单/编辑
 * dropdowns, ticket detail, and exports read the catalogs live, so every
 * change here shows through immediately.
 */

type CategoryRow = inferRouterOutputs<AppRouter>["ticketCategory"]["list"][number];
type ChannelRow = inferRouterOutputs<AppRouter>["channel"]["list"][number];

type Draft = { name: string; displayOrder: string };

const EMPTY_DRAFT: Draft = { name: "", displayOrder: "0" };

function CategoryDialog({
  open,
  category,
  onOpenChange,
}: {
  open: boolean;
  category: CategoryRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setDraft(
      category ? { name: category.name, displayOrder: String(category.displayOrder) } : EMPTY_DRAFT,
    );
    setErrors({});
  }, [open, category]);

  const closeAfterSave = () => {
    toast.success(category ? "类别已更新" : "类别已创建");
    utils.ticketCategory.invalidate();
    onOpenChange(false);
  };
  const create = trpc.ticketCategory.create.useMutation({ onSuccess: closeAfterSave });
  const update = trpc.ticketCategory.update.useMutation({ onSuccess: closeAfterSave });
  const pending = create.isPending || update.isPending;
  const mutationError = create.error ?? update.error;

  function save() {
    const parsed = ticketCategoryCreateInputSchema.safeParse({
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
    if (category) {
      update.mutate({ id: category.id, ...parsed.data });
    } else {
      create.mutate(parsed.data);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{category ? "编辑类别" : "新增类别"}</DialogTitle>
          <DialogDescription>
            改名对存量工单全局生效；调整顺序即调整建单下拉的呈现顺序。
          </DialogDescription>
        </DialogHeader>

        <FieldGroup>
          <Field data-invalid={Boolean(errors.name)}>
            <FieldLabel htmlFor="category-name">类别名称</FieldLabel>
            <Input
              id="category-name"
              value={draft.name}
              aria-invalid={Boolean(errors.name)}
              onChange={(event) =>
                setDraft((current) => ({ ...current, name: event.target.value }))
              }
            />
            <FieldError>{errors.name}</FieldError>
          </Field>

          <Field data-invalid={Boolean(errors.displayOrder)}>
            <FieldLabel htmlFor="category-order">显示顺序</FieldLabel>
            <Input
              id="category-order"
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

function DeleteCategoryDialog({
  category,
  onOpenChange,
}: {
  category: CategoryRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const remove = trpc.ticketCategory.delete.useMutation({
    onSuccess: () => {
      toast.success("类别已删除");
      utils.ticketCategory.invalidate();
      onOpenChange(false);
    },
  });
  return (
    <Dialog
      open={category !== null}
      onOpenChange={(next) => !remove.isPending && onOpenChange(next)}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>删除类别</DialogTitle>
          <DialogDescription>
            确定删除“{category?.name}”吗？已被工单使用的类别不能删除，只能停用。
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
            disabled={remove.isPending || !category}
            onClick={() => category && remove.mutate({ id: category.id })}
          >
            {remove.isPending && <Spinner data-icon="inline-start" />}
            {remove.isPending ? "删除中…" : "确认删除"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CategorySection() {
  const utils = trpc.useUtils();
  const list = trpc.ticketCategory.list.useQuery();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<CategoryRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CategoryRow | null>(null);

  const setActive = trpc.ticketCategory.setActive.useMutation({
    onSuccess: (category) => {
      toast.success(category?.active ? "类别已启用" : "类别已停用");
      utils.ticketCategory.invalidate();
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
          <h2 className="text-lg font-semibold">客诉类别</h2>
          <p className="text-sm text-muted-foreground">
            建单与编辑表单只列启用项；停用不影响存量工单的显示。
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus data-icon="inline-start" />
          新增类别
        </Button>
      </div>

      {list.error ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>类别加载失败</AlertTitle>
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
                        <EmptyTitle>暂无客诉类别</EmptyTitle>
                        <EmptyDescription>新增一个类别后即可在建单表单中选择。</EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  </TableCell>
                </TableRow>
              ) : (
                (list.data ?? []).map((category) => (
                  <TableRow key={category.id}>
                    <TableCell className="font-medium">{category.name}</TableCell>
                    <TableCell>{category.displayOrder}</TableCell>
                    <TableCell>
                      {category.active ? (
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
                          aria-label={`编辑 ${category.name}`}
                          onClick={() => {
                            setEditTarget(category);
                            setEditorOpen(true);
                          }}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`${category.active ? "停用" : "启用"} ${category.name}`}
                          disabled={setActive.isPending}
                          onClick={() =>
                            setActive.mutate({ id: category.id, active: !category.active })
                          }
                        >
                          {category.active ? <Ban /> : <CircleCheck />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`删除 ${category.name}`}
                          onClick={() => setDeleteTarget(category)}
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

      <CategoryDialog
        open={editorOpen}
        category={editTarget}
        onOpenChange={(open) => {
          setEditorOpen(open);
          if (!open) setEditTarget(null);
        }}
      />
      <DeleteCategoryDialog
        category={deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      />
    </section>
  );
}

function ChannelDialog({
  open,
  channel,
  onOpenChange,
}: {
  open: boolean;
  channel: ChannelRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setDraft(
      channel ? { name: channel.name, displayOrder: String(channel.displayOrder) } : EMPTY_DRAFT,
    );
    setErrors({});
  }, [open, channel]);

  const closeAfterSave = () => {
    toast.success(channel ? "渠道已更新" : "渠道已创建");
    utils.channel.invalidate();
    onOpenChange(false);
  };
  const create = trpc.channel.create.useMutation({ onSuccess: closeAfterSave });
  const update = trpc.channel.update.useMutation({ onSuccess: closeAfterSave });
  const pending = create.isPending || update.isPending;
  const mutationError = create.error ?? update.error;

  function save() {
    const parsed = channelCreateInputSchema.safeParse({
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
    if (channel) {
      update.mutate({ id: channel.id, ...parsed.data });
    } else {
      create.mutate(parsed.data);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{channel ? "编辑渠道" : "新增渠道"}</DialogTitle>
          <DialogDescription>
            改名对存量工单全局生效；调整顺序即调整建单下拉的呈现顺序。
          </DialogDescription>
        </DialogHeader>

        <FieldGroup>
          <Field data-invalid={Boolean(errors.name)}>
            <FieldLabel htmlFor="channel-name">渠道名称</FieldLabel>
            <Input
              id="channel-name"
              value={draft.name}
              aria-invalid={Boolean(errors.name)}
              onChange={(event) =>
                setDraft((current) => ({ ...current, name: event.target.value }))
              }
            />
            <FieldError>{errors.name}</FieldError>
          </Field>

          <Field data-invalid={Boolean(errors.displayOrder)}>
            <FieldLabel htmlFor="channel-order">显示顺序</FieldLabel>
            <Input
              id="channel-order"
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

function DeleteChannelDialog({
  channel,
  onOpenChange,
}: {
  channel: ChannelRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const remove = trpc.channel.delete.useMutation({
    onSuccess: () => {
      toast.success("渠道已删除");
      utils.channel.invalidate();
      onOpenChange(false);
    },
  });
  return (
    <Dialog
      open={channel !== null}
      onOpenChange={(next) => !remove.isPending && onOpenChange(next)}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>删除渠道</DialogTitle>
          <DialogDescription>
            确定删除“{channel?.name}”吗？已被工单使用的渠道不能删除，只能停用。
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
            disabled={remove.isPending || !channel}
            onClick={() => channel && remove.mutate({ id: channel.id })}
          >
            {remove.isPending && <Spinner data-icon="inline-start" />}
            {remove.isPending ? "删除中…" : "确认删除"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChannelSection() {
  const utils = trpc.useUtils();
  const list = trpc.channel.list.useQuery();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ChannelRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ChannelRow | null>(null);

  const setActive = trpc.channel.setActive.useMutation({
    onSuccess: (channel) => {
      toast.success(channel?.active ? "渠道已启用" : "渠道已停用");
      utils.channel.invalidate();
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
          <h2 className="text-lg font-semibold">反馈渠道</h2>
          <p className="text-sm text-muted-foreground">
            建单与编辑表单只列启用项；停用不影响存量工单的显示。
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus data-icon="inline-start" />
          新增渠道
        </Button>
      </div>

      {list.error ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>渠道加载失败</AlertTitle>
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
                        <EmptyTitle>暂无反馈渠道</EmptyTitle>
                        <EmptyDescription>新增一个渠道后即可在建单表单中选择。</EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  </TableCell>
                </TableRow>
              ) : (
                (list.data ?? []).map((channel) => (
                  <TableRow key={channel.id}>
                    <TableCell className="font-medium">{channel.name}</TableCell>
                    <TableCell>{channel.displayOrder}</TableCell>
                    <TableCell>
                      {channel.active ? (
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
                          aria-label={`编辑 ${channel.name}`}
                          onClick={() => {
                            setEditTarget(channel);
                            setEditorOpen(true);
                          }}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`${channel.active ? "停用" : "启用"} ${channel.name}`}
                          disabled={setActive.isPending}
                          onClick={() =>
                            setActive.mutate({ id: channel.id, active: !channel.active })
                          }
                        >
                          {channel.active ? <Ban /> : <CircleCheck />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`删除 ${channel.name}`}
                          onClick={() => setDeleteTarget(channel)}
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

      <ChannelDialog
        open={editorOpen}
        channel={editTarget}
        onOpenChange={(open) => {
          setEditorOpen(open);
          if (!open) setEditTarget(null);
        }}
      />
      <DeleteChannelDialog
        channel={deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      />
    </section>
  );
}

export function DictionaryPage() {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">渠道与类别</h1>
        <p className="text-sm text-muted-foreground">
          维护工单可选的目录项；改名全局生效，被工单使用中的目录项只能停用。
        </p>
      </div>
      <ChannelSection />
      <CategorySection />
    </div>
  );
}
