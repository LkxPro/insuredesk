/**
 * PROTOTYPE — throwaway. 渠道类型 × 分析主题交叉分析表：行可展开下钻到
 * 具体实体（保司/经纪公司/支付渠道）。合计列与总计行由传入叶子现算，不存。
 */
import { ChevronRight } from "lucide-react";
import { Fragment, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { type ComputedCrossRow, CROSS_COLUMNS, cellsTotal, sumCells } from "./mock-analysis";

function Num({
  v,
  strong = false,
  muted = false,
}: {
  v: number;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <TableCell
      className={cn(
        "text-right tabular-nums",
        strong && "font-semibold",
        v === 0 && "text-muted-foreground/40",
        muted && "text-muted-foreground",
      )}
    >
      {v}
    </TableCell>
  );
}

export function CrossAnalysisTable({
  rows,
  defaultExpandedIds = [],
}: {
  rows: ComputedCrossRow[];
  defaultExpandedIds?: readonly string[];
}) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set(defaultExpandedIds));
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });

  const totals = sumCells(rows.map((r) => r.cells));
  const grand = cellsTotal(totals);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-40">渠道类型</TableHead>
          {CROSS_COLUMNS.map((col) => (
            <TableHead key={col.key} className="text-right">
              {col.label}
            </TableHead>
          ))}
          <TableHead className="text-right">合计</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const open = expanded.has(row.id);
          return (
            <Fragment key={row.id}>
              <TableRow className="cursor-pointer" onClick={() => toggle(row.id)}>
                <TableCell>
                  <span className="flex items-center gap-1.5">
                    <ChevronRight
                      className={cn(
                        "size-4 shrink-0 text-muted-foreground transition-transform",
                        open && "rotate-90",
                      )}
                    />
                    <span className="font-medium">{row.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {row.entities.length} {row.entityLabel}
                    </span>
                  </span>
                </TableCell>
                {CROSS_COLUMNS.map((col) => (
                  <Num key={col.key} v={row.cells[col.key]} />
                ))}
                <Num v={cellsTotal(row.cells)} strong />
              </TableRow>
              {open &&
                row.entities.map((entity) => (
                  <TableRow key={entity.id} className="bg-muted/40 hover:bg-muted/60">
                    <TableCell className="pl-9 text-muted-foreground">{entity.name}</TableCell>
                    {CROSS_COLUMNS.map((col) => (
                      <Num key={col.key} v={entity.cells[col.key]} muted />
                    ))}
                    <Num v={cellsTotal(entity.cells)} muted />
                  </TableRow>
                ))}
            </Fragment>
          );
        })}
        <TableRow className="border-t-2 font-medium hover:bg-transparent">
          <TableCell>总计</TableCell>
          {CROSS_COLUMNS.map((col) => (
            <Num key={col.key} v={totals[col.key]} strong />
          ))}
          <Num v={grand} strong />
        </TableRow>
      </TableBody>
    </Table>
  );
}
