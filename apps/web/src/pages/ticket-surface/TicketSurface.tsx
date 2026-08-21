import { AlertCircle, ArrowDown, ArrowUp, ArrowUpDown, SlidersHorizontal } from "lucide-react";
import { memo, type ReactElement, type ReactNode, useCallback, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  type CrossPageDirection,
  type DetailNav,
  detailNav,
  useCrossPageNav,
} from "./detail-navigation";
import { ListSkeletonRows } from "./ListSkeletonRows";
import { TicketListFilterBar } from "./TicketListFilterBar";
import { TicketListPagination } from "./TicketListPagination";
import { type NarrowListItem, TicketNarrowList } from "./TicketNarrowList";
import { useTicketListUrl } from "./useTicketListUrl";

export type SurfaceQuery = {
  page: number;
  pageSize: number;
  search?: string | undefined;
  sortBy?: string | undefined;
  sortOrder?: "asc" | "desc" | undefined;
};

export type SurfaceListSlice<TItem> = {
  items: readonly TItem[];
  total: number;
  isLoading: boolean;
  isPlaceholderData: boolean;
  error: { message: string } | null;
};

export type SurfaceCtx<TItem, TQuery extends SurfaceQuery> = {
  query: TQuery;
  searchDraft: string;
  setSearchDraft: (value: string) => void;
  submitSearch: () => void;
  clearSearch: () => void;
  setParam: (key: string, value: string | null, opts?: { resetPage?: boolean }) => void;
  setParams: (updates: Readonly<Record<string, string | null>>) => void;
  detailOpen: boolean;
  /** 换单路径：basePath/:id + 当前筛选串；处理态内 replace（翻单是扫描动作），列表态 push。 */
  select: (ticketId: string) => void;
  ticketPath: (ticketId: string) => string;
  selected: ReadonlyMap<string, TItem>;
  clearSelection: () => void;
  removeSelected: (ids: readonly string[]) => void;
};

export type SurfaceColumn<TItem, TQuery extends SurfaceQuery> = {
  key: string;
  header: ReactNode;
  sort?: { field: string; initialOrder: "asc" | "desc" };
  headClassName?: string;
  render: (item: TItem, ctx: SurfaceCtx<TItem, TQuery>) => ReactNode;
};

export type SurfaceSelection<TItem, TQuery extends SurfaceQuery> = {
  selectable: (item: TItem) => boolean;
  rowLabel: (item: TItem) => string;
  pageLabel: string;
  bar: (selected: ReadonlyMap<string, TItem>, ctx: SurfaceCtx<TItem, TQuery>) => ReactNode;
};

export type SurfaceDetailProps = {
  ticketId: string;
  nav: DetailNav;
  onSwitch: (ticketId: string) => void;
  onCrossPage: (direction: CrossPageDirection) => void;
  onClose: () => void;
};

export function TicketSurface<TItem extends { id: string }, TQuery extends SurfaceQuery>({
  basePath,
  parseQuery,
  useList,
  title,
  subtitle,
  headerActions,
  filters,
  activeFilterCount,
  columns,
  emptyState,
  narrowItem,
  renderDetail,
  selection,
  isRowHighlighted,
  dialogs,
  listGapClassName = "gap-6",
}: {
  basePath: string;
  parseQuery: (params: URLSearchParams) => TQuery;
  useList: (query: TQuery) => SurfaceListSlice<TItem>;
  title: string;
  subtitle: ReactNode;
  headerActions?: (ctx: SurfaceCtx<TItem, TQuery>) => ReactNode;
  filters: (ctx: SurfaceCtx<TItem, TQuery>) => ReactNode;
  activeFilterCount: (query: TQuery) => number;
  columns: ReadonlyArray<SurfaceColumn<TItem, TQuery>>;
  emptyState: {
    icon: ReactNode;
    title: string;
    description: (query: TQuery) => ReactNode;
  };
  narrowItem: (item: TItem) => NarrowListItem;
  renderDetail: (props: SurfaceDetailProps) => ReactNode;
  selection?: SurfaceSelection<TItem, TQuery>;
  isRowHighlighted?: (item: TItem) => boolean;
  dialogs?: (ctx: SurfaceCtx<TItem, TQuery>) => ReactNode;
  listGapClassName?: string;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { id: detailId } = useParams<{ id: string }>();
  const { query, searchDraft, setSearchDraft, submitSearch, clearSearch, setParam, setParams } =
    useTicketListUrl(parseQuery);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // selection: id → item，跨页存活（翻页替换 items 不丢选择）
  const [selected, setSelected] = useState<ReadonlyMap<string, TItem>>(new Map());

  const detailOpen = detailId !== undefined;
  const list = useList(query);
  const items = list.items;
  const total = list.total;

  const select = useCallback(
    (ticketId: string) => {
      navigate(`${basePath}/${ticketId}${location.search}`, { replace: detailOpen });
    },
    [navigate, basePath, location.search, detailOpen],
  );

  const ticketPath = useCallback(
    (ticketId: string) => `${basePath}/${ticketId}${location.search}`,
    [basePath, location.search],
  );

  const nav = useMemo(
    () => detailNav(items, detailId, { page: query.page, pageSize: query.pageSize, total }),
    [items, detailId, query.page, query.pageSize, total],
  );
  const setPage = useCallback(
    (page: number) => setParam("page", String(page), { resetPage: false }),
    [setParam],
  );
  const crossPage = useCrossPageNav({
    items,
    page: query.page,
    isPlaceholderData: list.isPlaceholderData,
    select,
    setPage,
  });

  const toggleSort = useCallback(
    (field: string, initialOrder: "asc" | "desc") => {
      setParams({
        sortBy: field,
        sortOrder:
          query.sortBy === field ? (query.sortOrder === "desc" ? "asc" : "desc") : initialOrder,
      });
    },
    [setParams, query.sortBy, query.sortOrder],
  );

  const toggleSelected = useCallback((item: TItem) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(item.id)) {
        next.delete(item.id);
      } else {
        next.set(item.id, item);
      }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelected(new Map());
  }, []);

  const removeSelected = useCallback((ids: readonly string[]) => {
    setSelected((prev) => {
      const next = new Map(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
  }, []);

  const selectableItems = useMemo(
    () => (selection ? items.filter(selection.selectable) : []),
    [items, selection],
  );
  const allPageSelected =
    selectableItems.length > 0 && selectableItems.every((item) => selected.has(item.id));

  const togglePageSelection = useCallback(() => {
    if (!selection) return;
    setSelected((prev) => {
      const next = new Map(prev);
      for (const item of selectableItems) {
        if (allPageSelected) {
          next.delete(item.id);
        } else {
          next.set(item.id, item);
        }
      }
      return next;
    });
  }, [selection, selectableItems, allPageSelected]);

  const ctx: SurfaceCtx<TItem, TQuery> = useMemo(
    () => ({
      query,
      searchDraft,
      setSearchDraft,
      submitSearch,
      clearSearch,
      setParam,
      setParams,
      detailOpen,
      select,
      ticketPath,
      selected,
      clearSelection,
      removeSelected,
    }),
    [
      query,
      searchDraft,
      setSearchDraft,
      submitSearch,
      clearSearch,
      setParam,
      setParams,
      detailOpen,
      select,
      ticketPath,
      selected,
      clearSelection,
      removeSelected,
    ],
  );

  const columnCount = columns.length + (selection ? 1 : 0);
  const filterCount = activeFilterCount(query);

  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col",
        detailOpen ? "gap-3" : listGapClassName,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {!detailOpen && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">{headerActions?.(ctx)}</div>
      </div>

      {detailOpen && !filtersOpen && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>
            共 {total} 条{filterCount > 0 ? ` · ${filterCount} 个筛选条件` : " · 未筛选"}
          </span>
          <Button variant="outline" size="sm" onClick={() => setFiltersOpen(true)}>
            <SlidersHorizontal data-icon="inline-start" />
            展开筛选
          </Button>
        </div>
      )}

      {(!detailOpen || filtersOpen) && (
        <TicketListFilterBar>
          {detailOpen && (
            <Button variant="ghost" size="sm" onClick={() => setFiltersOpen(false)}>
              收起筛选
            </Button>
          )}
          {filters(ctx)}
        </TicketListFilterBar>
      )}

      {selection && !detailOpen && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/50 px-3 py-2 text-sm">
          {selection.bar(selected, ctx)}
        </div>
      )}

      {list.error ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>工单列表加载失败</AlertTitle>
          <AlertDescription>{list.error.message}</AlertDescription>
        </Alert>
      ) : detailOpen ? (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(14rem,1fr)_minmax(0,3fr)]">
          <div className="hidden min-h-0 rounded-md border lg:flex lg:flex-col">
            <TicketNarrowList
              items={items.map(narrowItem)}
              selectedId={detailId ?? ""}
              onSelect={select}
            />
          </div>
          <div className="flex min-h-0 flex-col rounded-md border">
            {renderDetail({
              ticketId: detailId ?? "",
              nav,
              onSwitch: select,
              onCrossPage: crossPage,
              onClose: () => navigate(`${basePath}${location.search}`),
            })}
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded-md border">
          <Table>
            {/* 表头随行滚动会丢失列语义，钉在滚动容器顶部 */}
            <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-background">
              <TableRow>
                {selection && (
                  <TableHead className="w-10">
                    <Checkbox
                      aria-label={selection.pageLabel}
                      checked={allPageSelected}
                      disabled={selectableItems.length === 0}
                      onCheckedChange={togglePageSelection}
                    />
                  </TableHead>
                )}
                {columns.map((column) => (
                  <TableHead key={column.key} className={column.headClassName}>
                    {column.sort ? (
                      <SortHead
                        label={column.header}
                        active={query.sortBy === column.sort.field}
                        order={query.sortBy === column.sort.field ? query.sortOrder : undefined}
                        onToggle={() =>
                          column.sort && toggleSort(column.sort.field, column.sort.initialOrder)
                        }
                      />
                    ) : (
                      column.header
                    )}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.isLoading ? (
                <ListSkeletonRows columnCount={columnCount} />
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columnCount} className="p-0">
                    <Empty className="border-0">
                      <EmptyHeader>
                        <EmptyMedia variant="icon">{emptyState.icon}</EmptyMedia>
                        <EmptyTitle>{emptyState.title}</EmptyTitle>
                        <EmptyDescription>{emptyState.description(query)}</EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  </TableCell>
                </TableRow>
              ) : (
                items.map((item) => (
                  <SurfaceRow
                    key={item.id}
                    item={item}
                    columns={columns}
                    ctx={ctx}
                    selection={selection}
                    isSelected={selected.has(item.id)}
                    selectable={selection ? selection.selectable(item) : false}
                    highlighted={isRowHighlighted?.(item) ?? false}
                    path={ticketPath(item.id)}
                    onToggleSelected={toggleSelected}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {!list.error && !detailOpen && (
        <TicketListPagination
          total={total}
          page={query.page}
          pageSize={query.pageSize}
          isLoading={list.isLoading}
          onPageChange={(page) => setParam("page", String(page), { resetPage: false })}
        />
      )}

      {dialogs?.(ctx)}
    </div>
  );
}

type SurfaceRowProps<TItem, TQuery extends SurfaceQuery> = {
  item: TItem;
  columns: ReadonlyArray<SurfaceColumn<TItem, TQuery>>;
  ctx: SurfaceCtx<TItem, TQuery>;
  selection?: SurfaceSelection<TItem, TQuery> | undefined;
  isSelected: boolean;
  selectable: boolean;
  highlighted: boolean;
  path: string;
  onToggleSelected: (item: TItem) => void;
};

// 泛型经下方断言保住——memo() 本身推不出泛型调用签名。
const SurfaceRow = memo(function SurfaceRow<
  TItem extends { id: string },
  TQuery extends SurfaceQuery,
>({
  item,
  columns,
  ctx,
  selection,
  isSelected,
  selectable,
  highlighted,
  path,
  onToggleSelected,
}: SurfaceRowProps<TItem, TQuery>) {
  const navigate = useNavigate();
  return (
    <TableRow
      data-highlighted={highlighted || undefined}
      className="group cursor-pointer data-[highlighted]:bg-primary/10 data-[highlighted]:hover:bg-primary/15"
      onClick={() => navigate(path)}
    >
      {selection && (
        // onClick swallows the row's navigation click; the checkbox inside is keyboard-operable
        <TableCell onClick={(event) => event.stopPropagation()}>
          <Checkbox
            aria-label={selection.rowLabel(item)}
            checked={isSelected}
            disabled={!selectable}
            onCheckedChange={() => onToggleSelected(item)}
          />
        </TableCell>
      )}
      {columns.map((column) => (
        <TableCell key={column.key}>{column.render(item, ctx)}</TableCell>
      ))}
    </TableRow>
  );
}) as <TItem extends { id: string }, TQuery extends SurfaceQuery>(
  props: SurfaceRowProps<TItem, TQuery>,
) => ReactElement;

function SortHead({
  label,
  active,
  order,
  onToggle,
}: {
  label: ReactNode;
  active: boolean;
  order: "asc" | "desc" | undefined;
  onToggle: () => void;
}) {
  const Icon = active ? (order === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <Button variant="ghost" size="sm" className="-ml-3 h-8" onClick={onToggle}>
      {label}
      <Icon data-icon="inline-end" className={active ? "" : "text-muted-foreground"} />
    </Button>
  );
}
