import { DASHBOARD_MATRIX_UNFILLED_KEY } from "@insuredesk/shared";
import { ChevronRight } from "lucide-react";
import { Fragment, useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { DashboardAnalysisStats } from "./dashboard-types";
import { SectionHeader } from "./section-header";

type Matrix = DashboardAnalysisStats["matrix"];
type MatrixRowData = Matrix["rows"][number];

type MatrixMode = "value" | "rowPct" | "colPct";

const MODE_LABELS: Array<{ value: MatrixMode; label: string }> = [
  { value: "value", label: "数值" },
  { value: "rowPct", label: "行占比" },
  { value: "colPct", label: "列占比" },
];

const MATRIX_NOTE =
  "行 = 反馈渠道目录全量，列 = 用户反馈渠道目录全量（含未填写），顺序跟随字典；悬浮单元格看数值/行占比/列占比。监管/未填写行无实体可展；总计 = 周期内投诉单总数。";

const columnKey = (id: string | null) => id ?? DASHBOARD_MATRIX_UNFILLED_KEY;
const rowKey = (row: MatrixRowData) => row.channelId ?? DASHBOARD_MATRIX_UNFILLED_KEY;

const fmtPct = (value: number) => `${value.toFixed(1)}%`;

function HeatCell({
  rowName,
  colName,
  value,
  totalOfRow,
  totalOfCol,
  normMax,
  mode,
}: {
  rowName: string;
  colName: string;
  value: number;
  totalOfRow: number;
  totalOfCol: number;
  normMax: number;
  mode: MatrixMode;
}) {
  if (value === 0) {
    return <span className="text-muted-foreground/30">·</span>;
  }
  const rowPct = totalOfRow === 0 ? 0 : (value / totalOfRow) * 100;
  const colPct = totalOfCol === 0 ? 0 : (value / totalOfCol) * 100;
  const intensity = normMax === 0 ? 0 : value / normMax;
  const alpha = 12 + intensity * 74;
  const hue = `color-mix(in oklab, var(--chart-3) ${(100 - intensity * 100).toFixed(0)}%, var(--destructive))`;
  const display = mode === "value" ? String(value) : fmtPct(mode === "rowPct" ? rowPct : colPct);
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
        {rowName} × {colName}：{value} 单 · 行内 {fmtPct(rowPct)} · 列内 {fmtPct(colPct)}
      </TooltipContent>
    </Tooltip>
  );
}

function TotalCell({
  value,
  max,
  strong = false,
}: {
  value: number;
  max: number;
  strong?: boolean;
}) {
  return (
    <div className="flex flex-col items-end gap-1">
      <span className={cn("tabular-nums", strong && "font-semibold")}>{value}</span>
      <div
        className="h-1 rounded-full"
        style={{
          width: `${max === 0 ? 0 : Math.max((value / max) * 100, value > 0 ? 4 : 0)}%`,
          backgroundColor: "var(--chart-3)",
        }}
      />
    </div>
  );
}

function MatrixCells({
  ownerName,
  cells,
  columns,
  totalOfRow,
  colTotals,
  tableMax,
  mode,
}: {
  ownerName: string;
  cells: Record<string, number>;
  columns: Matrix["columns"];
  totalOfRow: number;
  colTotals: Record<string, number>;
  tableMax: number;
  mode: MatrixMode;
}) {
  return (
    <>
      {columns.map((column) => (
        <TableCell key={columnKey(column.id)} className="text-right">
          <HeatCell
            rowName={ownerName}
            colName={column.name}
            value={cells[columnKey(column.id)] ?? 0}
            totalOfRow={totalOfRow}
            totalOfCol={colTotals[columnKey(column.id)] ?? 0}
            normMax={tableMax}
            mode={mode}
          />
        </TableCell>
      ))}
    </>
  );
}

export function MatrixSection({ matrix }: { matrix: Matrix }) {
  const [mode, setMode] = useState<MatrixMode>("value");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });

  const { columns, rows } = matrix;
  const keys = columns.map((column) => columnKey(column.id));
  const rowTotal = (cells: Record<string, number>) =>
    keys.reduce((sum, key) => sum + (cells[key] ?? 0), 0);
  const colTotals: Record<string, number> = {};
  let tableMax = 0;
  for (const key of keys) {
    colTotals[key] = rows.reduce((sum, row) => sum + (row.cells[key] ?? 0), 0);
  }
  for (const row of rows) {
    for (const key of keys) {
      tableMax = Math.max(tableMax, row.cells[key] ?? 0);
    }
  }
  const rowTotals = rows.map((row) => rowTotal(row.cells));
  const maxRowTotal = Math.max(...rowTotals, 1);
  const maxColTotal = Math.max(...Object.values(colTotals), 1);
  const grand = rowTotals.reduce((sum, value) => sum + value, 0);

  const stickyLabel = "sticky left-0 z-10 bg-card";
  const stickyTotal = "sticky right-0 z-10 border-l bg-card";

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        title="渠道 × 用户反馈渠道交叉分析"
        note="投诉单 · 统计周期内创建 · 热力蓝→红全表归一"
      />
      <Card>
        <CardHeader className="flex-row items-center justify-end">
          <ToggleGroup
            type="single"
            size="sm"
            value={mode}
            onValueChange={(value) => value && setMode(value as MatrixMode)}
          >
            {MODE_LABELS.map((item) => (
              <ToggleGroupItem key={item.value} value={item.value}>
                {item.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </CardHeader>
        <CardContent>
          <TooltipProvider>
            <div className="overflow-x-auto">
              <Table style={{ minWidth: `${240 + columns.length * 96}px` }}>
                <TableHeader>
                  <TableRow>
                    <TableHead className={cn("w-36", stickyLabel)}>渠道类型</TableHead>
                    {columns.map((column) => (
                      <TableHead
                        key={columnKey(column.id)}
                        className={cn(
                          "text-right text-xs whitespace-nowrap",
                          column.id === null && "text-muted-foreground/60",
                        )}
                      >
                        {column.name}
                      </TableHead>
                    ))}
                    <TableHead className={cn("w-20 text-right", stickyTotal)}>合计</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const key = rowKey(row);
                    const expandable = row.entities.length > 0;
                    const open = expanded.has(key);
                    return (
                      <Fragment key={key}>
                        <TableRow
                          className={cn(expandable && "cursor-pointer")}
                          onClick={expandable ? () => toggle(key) : undefined}
                        >
                          <TableCell className={stickyLabel}>
                            <span
                              className={cn(
                                "flex items-center gap-1.5",
                                row.channelId === null && "text-muted-foreground/60",
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
                              {expandable && (
                                <span className="text-xs whitespace-nowrap text-muted-foreground">
                                  {row.entities.length} 实体
                                </span>
                              )}
                            </span>
                          </TableCell>
                          <MatrixCells
                            ownerName={row.name}
                            cells={row.cells}
                            columns={columns}
                            totalOfRow={rowTotal(row.cells)}
                            colTotals={colTotals}
                            tableMax={tableMax}
                            mode={mode}
                          />
                          <TableCell className={cn("text-right", stickyTotal)}>
                            <TotalCell value={rowTotal(row.cells)} max={maxRowTotal} strong />
                          </TableCell>
                        </TableRow>
                        {open &&
                          row.entities.map((entity) => (
                            <TableRow key={entity.name} className="hover:bg-transparent">
                              <TableCell
                                className={cn(stickyLabel, "pl-9 text-muted-foreground")}
                                style={{ backgroundColor: "var(--muted)" }}
                              >
                                {entity.name}
                              </TableCell>
                              <MatrixCells
                                ownerName={entity.name}
                                cells={entity.cells}
                                columns={columns}
                                totalOfRow={rowTotal(entity.cells)}
                                colTotals={colTotals}
                                tableMax={tableMax}
                                mode={mode}
                              />
                              <TableCell
                                className={cn("text-right", stickyTotal)}
                                style={{ backgroundColor: "var(--muted)" }}
                              >
                                <TotalCell value={rowTotal(entity.cells)} max={maxRowTotal} />
                              </TableCell>
                            </TableRow>
                          ))}
                      </Fragment>
                    );
                  })}
                  <TableRow className="border-t-2 hover:bg-transparent">
                    <TableCell className={cn("font-medium", stickyLabel)}>总计</TableCell>
                    {columns.map((column) => (
                      <TableCell key={columnKey(column.id)} className="text-right">
                        <TotalCell value={colTotals[columnKey(column.id)] ?? 0} max={maxColTotal} />
                      </TableCell>
                    ))}
                    <TableCell className={cn("text-right", stickyTotal)}>
                      <TotalCell value={grand} max={grand} strong />
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </TooltipProvider>
          <p className="mt-3 text-xs text-muted-foreground">{MATRIX_NOTE}</p>
        </CardContent>
      </Card>
    </section>
  );
}

export function MatrixSectionSkeleton() {
  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        title="渠道 × 用户反馈渠道交叉分析"
        note="投诉单 · 统计周期内创建 · 热力蓝→红全表归一"
      />
      <Card>
        <CardContent className="flex flex-col gap-2 pt-6">
          {[0, 1, 2, 3].map((row) => (
            <Skeleton key={row} className="h-8 w-full" />
          ))}
        </CardContent>
      </Card>
    </section>
  );
}
