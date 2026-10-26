import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, ListChecks } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import {
  RANK_LEVEL_LABEL,
  RANK_LEVEL_SHORT,
  RANK_LEVELS,
  type Ranking,
  type RankingRow,
  type RankLevel,
} from "./region-ranking";
import type { RegionPath } from "./region-search";

export const RANKING_ROW_LIMIT = 100;

const MEDAL: Record<number, string> = {
  1: "bg-yellow-500 text-yellow-950",
  2: "bg-gray-400 text-gray-950",
  3: "bg-orange-600 text-orange-50",
};

type SortOrder = "desc" | "asc";

export function RegionRanking({
  ranking,
  level,
  levels,
  onLevelChange,
  onRowSelect,
  onOpenTickets,
  search,
  highlightCodes,
}: {
  ranking: Ranking;
  level: RankLevel;
  levels: readonly RankLevel[];
  onLevelChange: (level: RankLevel) => void;
  onRowSelect: (path: RegionPath) => void;
  /** 有 ticket.view 时叶子行可跳转工单列表。 */
  onOpenTickets?: (code: string) => void;
  search?: ReactNode;
  highlightCodes: readonly string[];
}) {
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [isCollapsed, setIsCollapsed] = useState(false);
  const label = RANK_LEVEL_LABEL[level];

  const highlighted = useMemo(
    () => ranking.rows.find((row) => highlightCodes.includes(row.code)) ?? null,
    [ranking, highlightCodes],
  );

  const visibleRows = useMemo(() => {
    // 名次按数量从多到少定，升序只是倒过来看
    const ordered = sortOrder === "desc" ? ranking.rows : [...ranking.rows].reverse();
    const shown = ordered.slice(0, RANKING_ROW_LIMIT);
    return highlighted && !shown.includes(highlighted) ? [...shown, highlighted] : shown;
  }, [ranking, sortOrder, highlighted]);
  const truncated = ranking.rows.length > RANKING_ROW_LIMIT;

  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  // biome-ignore lint/correctness/useExhaustiveDependencies: 排序/层级变化后行重排，需重新滚到高亮行
  useEffect(() => {
    if (highlighted && !isCollapsed) {
      rowRefs.current.get(highlighted.code)?.scrollIntoView?.({ block: "nearest" });
    }
  }, [highlighted, isCollapsed, visibleRows]);

  return (
    <Card className="absolute left-4 top-4 z-10 w-96 gap-3 shadow-lg">
      <CardHeader className="gap-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{label}排名</CardTitle>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSortOrder((prev) => (prev === "desc" ? "asc" : "desc"))}
              className="h-8 px-2"
              aria-label={sortOrder === "desc" ? "切换为升序" : "切换为降序"}
            >
              {sortOrder === "desc" ? <ArrowDown /> : <ArrowUp />}
              {sortOrder === "desc" ? "降序" : "升序"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="h-8 px-2"
              aria-label={isCollapsed ? "展开" : "收起"}
            >
              {isCollapsed ? <ChevronDown /> : <ChevronUp />}
            </Button>
          </div>
        </div>
        {search}
        {!isCollapsed && (
          <>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={level}
              onValueChange={(next) => {
                if (next) onLevelChange(next as RankLevel);
              }}
              aria-label="排名层级"
              className="w-full"
            >
              {RANK_LEVELS.map((option) => (
                <ToggleGroupItem
                  key={option}
                  value={option}
                  disabled={!levels.includes(option)}
                  className="flex-1"
                >
                  {RANK_LEVEL_SHORT[option]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <CardDescription>
              共 {ranking.rows.length} 个{label}，{ranking.total} 例工单
              {truncated && `，显示前 ${RANKING_ROW_LIMIT} 名`}
            </CardDescription>
          </>
        )}
      </CardHeader>
      {!isCollapsed && (
        <CardContent>
          <ScrollArea className="h-[400px] pr-3">
            {visibleRows.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">暂无已定位工单</p>
            ) : (
              <div className="space-y-2">
                {visibleRows.map((row) => (
                  <RankingRowItem
                    key={row.code}
                    row={row}
                    share={ranking.total > 0 ? row.count / ranking.total : 0}
                    detached={row === highlighted && visibleRows.indexOf(row) >= RANKING_ROW_LIMIT}
                    highlighted={row === highlighted}
                    onSelect={() => onRowSelect(row.path)}
                    onOpenTickets={
                      onOpenTickets && row.leaf ? () => onOpenTickets(row.code) : undefined
                    }
                    rowRef={(element) => {
                      if (element) rowRefs.current.set(row.code, element);
                      else rowRefs.current.delete(row.code);
                    }}
                  />
                ))}
              </div>
            )}
            {ranking.excluded > 0 && (
              <p className="mt-3 text-xs text-muted-foreground">
                另有 {ranking.excluded} 例的地址没有{label}一级（如东莞、台湾），未计入。
              </p>
            )}
          </ScrollArea>
        </CardContent>
      )}
    </Card>
  );
}

function RankingRowItem({
  row,
  share,
  detached,
  highlighted,
  onSelect,
  onOpenTickets,
  rowRef,
}: {
  row: RankingRow;
  share: number;
  detached: boolean;
  highlighted: boolean;
  onSelect: () => void;
  onOpenTickets?: () => void;
  rowRef: (element: HTMLDivElement | null) => void;
}) {
  return (
    <div
      ref={rowRef}
      aria-current={highlighted || undefined}
      className={cn(
        "group flex items-center rounded-md border transition-colors hover:bg-accent",
        highlighted && "border-orange-400 bg-orange-50 dark:bg-orange-950/40",
        detached && "mt-4",
      )}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 p-2 text-left"
        aria-label={`第 ${row.rank} 名 ${[row.parentLabel, row.name].filter(Boolean).join(" ")} ${row.count} 例`}
        onClick={onSelect}
      >
        <span
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
            MEDAL[row.rank] ?? "bg-muted text-muted-foreground",
          )}
        >
          {row.rank}
        </span>
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium">{row.name}</span>
          {row.parentLabel && (
            <span className="ml-1.5 text-xs text-muted-foreground">{row.parentLabel}</span>
          )}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {(share * 100).toFixed(1)}%
        </span>
        <span className="w-8 shrink-0 text-right font-semibold tabular-nums">{row.count}</span>
      </button>
      {onOpenTickets ? (
        <Button
          variant="ghost"
          size="icon"
          className="mr-1 size-7 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          aria-label={`查看${row.name}工单`}
          title="查看工单"
          onClick={onOpenTickets}
        >
          <ListChecks />
        </Button>
      ) : (
        <span className="mr-1 size-7 shrink-0" />
      )}
    </div>
  );
}
