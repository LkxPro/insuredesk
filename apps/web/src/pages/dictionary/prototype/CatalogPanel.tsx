import { Ban, CircleCheck, GripVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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

interface ProtoRow {
  id: string;
  name: string;
  active: boolean;
  displayOrder: number;
}

const STRESS_COUNT = 24;

function buildRows(data: ProtoRow[], config: CatalogAdminConfig, stress: boolean): ProtoRow[] {
  const rows = [...data];
  if (stress) {
    for (let i = rows.length; i < STRESS_COUNT; i++) {
      rows.push({
        id: `pad-${config.idPrefix}-${i}`,
        name: `${config.nameNoun}${String(i + 1).padStart(2, "0")}`,
        active: i % 4 !== 3,
        displayOrder: i + 1,
      });
    }
  }
  return rows;
}

function stub(action: string) {
  return () => toast.info(`原型：「${action}」未接线，这里只演示列表组织与拖拽排序`);
}

export function CatalogPanel({ config, stress }: { config: CatalogAdminConfig; stress: boolean }) {
  const list = config.hooks.useList();
  const [rows, setRows] = useState<ProtoRow[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  useEffect(() => {
    if (list.data) setRows(buildRows(list.data, config, stress));
  }, [list.data, config, stress]);

  function dropAt(target: number) {
    const from = dragIndex;
    setDragIndex(null);
    setOverIndex(null);
    if (from === null || from === target) return;
    setRows((current) => {
      const next = [...current];
      const moved = next.splice(from, 1)[0];
      if (!moved) return current;
      next.splice(target, 0, moved);
      return next.map((row, i) => ({ ...row, displayOrder: i + 1 }));
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{config.subtitle}</p>
        <Button onClick={stub(`新增${config.noun}`)}>
          <Plus data-icon="inline-start" />
          新增{config.noun}
        </Button>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10" />
              <TableHead>名称</TableHead>
              <TableHead>显示顺序</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="w-36">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.isLoading ? (
              [0, 1, 2].map((row) => (
                <TableRow key={row}>
                  <TableCell colSpan={5}>
                    <Skeleton className="h-5 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  暂无{config.title}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row, index) => (
                <TableRow
                  key={row.id}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    setDragIndex(index);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setOverIndex(index);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    dropAt(index);
                  }}
                  onDragEnd={() => {
                    setDragIndex(null);
                    setOverIndex(null);
                  }}
                  className={[
                    dragIndex === index ? "opacity-40" : "",
                    overIndex === index && dragIndex !== null && dragIndex !== index
                      ? "bg-accent"
                      : "",
                  ].join(" ")}
                >
                  <TableCell className="cursor-grab text-muted-foreground active:cursor-grabbing">
                    <GripVertical className="size-4" />
                  </TableCell>
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
                      <Button variant="ghost" size="icon-sm" onClick={stub("编辑")}>
                        <Pencil />
                      </Button>
                      <Button variant="ghost" size="icon-sm" onClick={stub("停用/启用")}>
                        {row.active ? <Ban /> : <CircleCheck />}
                      </Button>
                      <Button variant="ghost" size="icon-sm" onClick={stub("删除")}>
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
      <p className="text-xs text-muted-foreground">原型：拖拽重排只在本地预览，刷新即还原。</p>
    </div>
  );
}
