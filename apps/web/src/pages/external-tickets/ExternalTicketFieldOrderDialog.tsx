import { ArrowDown, ArrowUp, GripVertical, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { externalFieldLabel } from "./external-ticket-fields";

function moveField(fields: readonly string[], field: string, targetIndex: number): string[] {
  const from = fields.indexOf(field);
  if (from < 0 || targetIndex < 0 || targetIndex >= fields.length || from === targetIndex) {
    return [...fields];
  }
  const next = [...fields];
  next.splice(from, 1);
  next.splice(targetIndex, 0, field);
  return next;
}

function sameFieldOrder(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((field, index) => field === right[index]);
}

function OrderedFields({
  fields,
  onChange,
}: {
  fields: readonly string[];
  onChange: (fields: string[]) => void;
}) {
  const [dragged, setDragged] = useState<string | null>(null);
  return (
    <ol className="m-0 flex list-none flex-col gap-1 p-0">
      {fields.map((field, index) => (
        <li
          key={field}
          draggable
          onDragStart={(event) => {
            setDragged(field);
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", field);
          }}
          onDragEnd={() => setDragged(null)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const source = dragged ?? event.dataTransfer.getData("text/plain");
            onChange(moveField(fields, source, index));
            setDragged(null);
          }}
          className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5"
        >
          <GripVertical className="size-4 cursor-grab text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-sm">{externalFieldLabel(field)}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`上移 ${externalFieldLabel(field)}`}
            disabled={index === 0}
            onClick={() => onChange(moveField(fields, field, index - 1))}
          >
            <ArrowUp />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`下移 ${externalFieldLabel(field)}`}
            disabled={index === fields.length - 1}
            onClick={() => onChange(moveField(fields, field, index + 1))}
          >
            <ArrowDown />
          </Button>
        </li>
      ))}
    </ol>
  );
}

export function ExternalTicketFieldOrderDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const preferences = trpc.externalTicket.preferences.useQuery(undefined, { enabled: open });
  const updatePreferences = trpc.externalTicket.updatePreferences.useMutation();
  const [listFields, setListFields] = useState<string[]>([]);
  const [exportFields, setExportFields] = useState<string[]>([]);
  const [initialListFields, setInitialListFields] = useState<string[]>([]);
  const [initialExportFields, setInitialExportFields] = useState<string[]>([]);
  const [resetList, setResetList] = useState(false);
  const [resetExport, setResetExport] = useState(false);

  useEffect(() => {
    if (!open || !preferences.data) return;
    setListFields(preferences.data.listFields);
    setExportFields(preferences.data.exportFields);
    setInitialListFields(preferences.data.listFields);
    setInitialExportFields(preferences.data.exportFields);
    setResetList(false);
    setResetExport(false);
  }, [open, preferences.data]);

  async function save() {
    try {
      const updates: Promise<unknown>[] = [];
      if (resetList || !sameFieldOrder(listFields, initialListFields)) {
        updates.push(
          updatePreferences.mutateAsync({
            surface: "list",
            fields: resetList ? [] : listFields,
          }),
        );
      }
      if (resetExport || !sameFieldOrder(exportFields, initialExportFields)) {
        updates.push(
          updatePreferences.mutateAsync({
            surface: "export",
            fields: resetExport ? [] : exportFields,
          }),
        );
      }
      await Promise.all(updates);
      await Promise.all([
        utils.externalTicket.preferences.invalidate(),
        utils.externalTicket.list.invalidate(),
      ]);
      toast.success("字段顺序已保存");
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "字段顺序保存失败");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>字段顺序</DialogTitle>
          <DialogDescription>
            拖拽字段调整顺序；一级列表与 Excel/CSV 导出互不影响。
          </DialogDescription>
        </DialogHeader>
        {preferences.isLoading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : preferences.error ? (
          <p className="text-sm text-destructive">{preferences.error.message}</p>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2">
            <section className="flex min-w-0 flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-medium">一级列表</h3>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setListFields(preferences.data?.defaultListFields ?? []);
                    setResetList(true);
                  }}
                >
                  <RotateCcw />
                  恢复管理员默认
                </Button>
              </div>
              <OrderedFields
                fields={listFields}
                onChange={(fields) => {
                  setListFields(fields);
                  setResetList(false);
                }}
              />
            </section>
            <section className="flex min-w-0 flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-medium">导出列</h3>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setExportFields(preferences.data?.defaultExportFields ?? []);
                    setResetExport(true);
                  }}
                >
                  <RotateCcw />
                  恢复管理员默认
                </Button>
              </div>
              <OrderedFields
                fields={exportFields}
                onChange={(fields) => {
                  setExportFields(fields);
                  setResetExport(false);
                }}
              />
            </section>
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            type="button"
            disabled={!preferences.data || updatePreferences.isPending}
            onClick={save}
          >
            {updatePreferences.isPending ? "保存中…" : "保存顺序"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
