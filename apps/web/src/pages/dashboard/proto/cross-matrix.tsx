/**
 * PROTOTYPE — throwaway. 全量字典交叉矩阵：行 = 反馈渠道目录（含未填写），
 * 列 = 用户反馈渠道目录（含未填写），均数据驱动。V10+：双极热力（蓝→红，
 * 按列/全表归一可选）、数值/行占比/列占比三种显示模式、hover 给完整三件套；
 * 合计列/总计行内嵌数据条；行展开到实体明细（监管/未填写行无实体不展开）。
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { type MatrixRow, UFC_COLUMNS } from "./mock-analysis";

export type MatrixMode = "value" | "rowPct" | "colPct";
export type HeatScope = "column" | "table";

const rowTotal = (cells: Record<string, number>) =>
  UFC_COLUMNS.reduce((s, c) => s + (cells[c.id] ?? 0), 0);

const fmtPct = (v: number) => `${v.toFixed(1)}%`;

function Heat({
  rowName,
  colName,
  v,
  totalOfRow,
  totalOfCol,
  normMax,
  heat,
  mode,
}: {
  rowName: string;
  colName: string;
  v: number;
  totalOfRow: number;
  totalOfCol: number;
  normMax: number;
  heat: "soft" | "strong";
  mode: MatrixMode;
}) {
  const rowPct = totalOfRow === 0 ? 0 : (v / totalOfRow) * 100;
  const colPct = totalOfCol === 0 ? 0 : (v / totalOfCol) * 100;
  if (v === 0) {
    return <span className="text-muted-foreground/30">·</span>;
  }
  const intensity = normMax === 0 ? 0 : v / normMax;
  const alpha = heat === "strong" ? 12 + intensity * 74 : intensity * 30;
  const hue = `color-mix(in oklab, var(--chart-3) ${(100 - intensity * 100).toFixed(0)}%, var(--destructive))`;
  const display = mode === "value" ? String(v) : fmtPct(mode === "rowPct" ? rowPct : colPct);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="inline-block min-w-8 cursor-default rounded-sm px-1 py-0.5 tabular-nums"
          style={{
            backgroundColor: `color-mix(in oklab, ${hue} ${alpha.toFixed(1)}%, transparent)`,
          }}
        >
          {display}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {rowName} × {colName}:{v} 单 · 行内 {fmtPct(rowPct)} · 列内 {fmtPct(colPct)}
      </TooltipContent>
    </Tooltip>
  );
}

function TotalCell({ v, max, strong = false }: { v: number; max: number; strong?: boolean }) {
  return (
    <div className="flex flex-col items-end gap-1">
      <span className={cn("tabular-nums", strong && "font-semibold")}>{v}</span>
      <div
        className="h-1 rounded-full"
        style={{
          width: `${max === 0 ? 0 : Math.max((v / max) * 100, v > 0 ? 4 : 0)}%`,
          backgroundColor: "var(--chart-3)",
        }}
      />
    </div>
  );
}

export function CrossMatrixTable({
  rows,
  defaultExpandedIds = [],
  heat = "soft",
  heatScope = "column",
  mode = "value",
}: {
  rows: MatrixRow[];
  defaultExpandedIds?: readonly string[];
  heat?: "soft" | "strong";
  heatScope?: HeatScope;
  mode?: MatrixMode;
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

  const colTotals: Record<string, number> = {};
  const colMax: Record<string, number> = {};
  for (const col of UFC_COLUMNS) {
    colTotals[col.id] = rows.reduce((s, r) => s + (r.cells[col.id] ?? 0), 0);
    colMax[col.id] = Math.max(...rows.map((r) => r.cells[col.id] ?? 0), 0);
  }
  const tableMax = Math.max(...Object.values(colMax), 0);
  const rowTotals = rows.map((r) => rowTotal(r.cells));
  const maxRowTotal = Math.max(...rowTotals, 1);
  const maxColTotal = Math.max(...Object.values(colTotals), 1);
  const grand = rowTotals.reduce((s, v) => s + v, 0);

  const normMax = (colId: string) => (heatScope === "table" ? tableMax : (colMax[colId] ?? 0));

  const stickyLabel = "sticky left-0 z-10 bg-card";
  const stickyTotal = "sticky right-0 z-10 bg-card border-l";

  return (
    <TooltipProvider>
      <div className="overflow-x-auto">
        <Table className="min-w-[1240px]">
          <TableHeader>
            <TableRow>
              <TableHead className={cn("w-36", stickyLabel)}>渠道类型</TableHead>
              {UFC_COLUMNS.map((col) => (
                <TableHead
                  key={col.id}
                  className={cn(
                    "text-right text-xs whitespace-nowrap",
                    col.unfilled && "text-muted-foreground/60",
                  )}
                >
                  {col.name}
                </TableHead>
              ))}
              <TableHead className={cn("w-20 text-right", stickyTotal)}>合计</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const expandable = (row.entities?.length ?? 0) > 0;
              const open = expanded.has(row.id);
              return (
                <Fragment key={row.id}>
                  <TableRow
                    className={cn(expandable && "cursor-pointer")}
                    onClick={expandable ? () => toggle(row.id) : undefined}
                  >
                    <TableCell className={stickyLabel}>
                      <span
                        className={cn(
                          "flex items-center gap-1.5",
                          row.unfilled && "text-muted-foreground/60",
                        )}
                      >
                        {expandable ? (
                          <ChevronRight
                            className={cn(
                              "size-4 shrink-0 text-muted-foreground transition-transform",
                              open && "rotate-90",
                            )}
                          />
                        ) : (
                          <span className="size-4 shrink-0" />
                        )}
                        <span className="font-medium">{row.name}</span>
                        {row.entities && (
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {row.entities.length} {row.entityLabel}
                          </span>
                        )}
                      </span>
                    </TableCell>
                    {UFC_COLUMNS.map((col) => (
                      <TableCell key={col.id} className="text-right">
                        <Heat
                          rowName={row.name}
                          colName={col.name}
                          v={row.cells[col.id] ?? 0}
                          totalOfRow={rowTotal(row.cells)}
                          totalOfCol={colTotals[col.id] ?? 0}
                          normMax={normMax(col.id)}
                          heat={heat}
                          mode={mode}
                        />
                      </TableCell>
                    ))}
                    <TableCell className={cn("text-right", stickyTotal)}>
                      <TotalCell v={rowTotal(row.cells)} max={maxRowTotal} strong />
                    </TableCell>
                  </TableRow>
                  {open &&
                    row.entities?.map((entity) => (
                      <TableRow key={entity.id} className="hover:bg-transparent">
                        <TableCell
                          className={cn(stickyLabel, "pl-9 text-muted-foreground")}
                          style={{ backgroundColor: "var(--muted)" }}
                        >
                          {entity.name}
                        </TableCell>
                        {UFC_COLUMNS.map((col) => (
                          <TableCell
                            key={col.id}
                            className="text-right"
                            style={{ backgroundColor: "var(--muted)" }}
                          >
                            <Heat
                              rowName={entity.name}
                              colName={col.name}
                              v={entity.cells[col.id] ?? 0}
                              totalOfRow={rowTotal(entity.cells)}
                              totalOfCol={colTotals[col.id] ?? 0}
                              normMax={normMax(col.id)}
                              heat={heat}
                              mode={mode}
                            />
                          </TableCell>
                        ))}
                        <TableCell
                          className={cn("text-right", stickyTotal)}
                          style={{ backgroundColor: "var(--muted)" }}
                        >
                          <TotalCell v={rowTotal(entity.cells)} max={maxRowTotal} />
                        </TableCell>
                      </TableRow>
                    ))}
                </Fragment>
              );
            })}
            <TableRow className="border-t-2 hover:bg-transparent">
              <TableCell className={cn("font-medium", stickyLabel)}>总计</TableCell>
              {UFC_COLUMNS.map((col) => (
                <TableCell key={col.id} className="text-right">
                  <TotalCell v={colTotals[col.id] ?? 0} max={maxColTotal} />
                </TableCell>
              ))}
              <TableCell className={cn("text-right", stickyTotal)}>
                <TotalCell v={grand} max={grand} strong />
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </TooltipProvider>
  );
}
