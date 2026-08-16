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

/**
 * 工单表面深模块：三态骨架（全宽表格 / 窄列+详情主从 / 处理态筛选折叠）、
 * URL 筛选态（查询串是唯一事实源，筛选变更回第 1 页）、翻单契约（切片内
 * 方向键 + 越界翻页）与可选 selection，只在这里维护一份。内外两个工单页
 * 各退为薄 adapter：basePath、查询 hook、列定义（含可选排序）、筛选维度、
 * 头部动作槽、对话框槽、详情 pane 全部由槽位注入——本模块不认识任何具体
 * 动作与权限点，接口上没有 capability 布尔 flag。
 *
 * 列表态全宽表格，行点击进入 basePath/:id 处理态：同一份列表数据压缩成左
 * 侧窄列，右侧是 adapter 注入的详情 pane；处理态下筛选器收起为一行摘要＋
 * 展开按钮（筛选值仍在 URL 里，切态不丢），分页与选中条退场。窄屏
 * (<1024px) 降级为详情覆盖窄列，桌面优先。筛选串随换单路径带走，深链与
 * 刷新都不丢上下文。
 */

/** 深模块对查询形状的全部要求：分页必读，搜索/排序按槽位启用。 */
export type SurfaceQuery = {
  page: number;
  pageSize: number;
  search?: string | undefined;
  sortBy?: string | undefined;
  sortOrder?: "asc" | "desc" | undefined;
};

/** useList 槽的返回切片：深模块只消费这五样。 */
export type SurfaceListSlice<TItem> = {
  items: readonly TItem[];
  total: number;
  isLoading: boolean;
  isPlaceholderData: boolean;
  error: { message: string } | null;
};

/** 注入槽位可用的上下文：URL 写入器、换单路径与 selection 状态。 */
export type SurfaceCtx<TItem, TQuery extends SurfaceQuery> = {
  query: TQuery;
  searchDraft: string;
  setSearchDraft: (value: string) => void;
  submitSearch: () => void;
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
  /** 给了 sort 即渲染排序表头：首击取 initialOrder，再击翻转，写 sortBy/sortOrder 回 URL。 */
  sort?: { field: string; initialOrder: "asc" | "desc" };
  headClassName?: string;
  render: (item: TItem, ctx: SurfaceCtx<TItem, TQuery>) => ReactNode;
};

/** selection 能力：勾选列 + 列表态选中条；整槽不给即无 selection。 */
export type SurfaceSelection<TItem, TQuery extends SurfaceQuery> = {
  /** 行是否可选（如终态行不可选）。 */
  selectable: (item: TItem) => boolean;
  rowLabel: (item: TItem) => string;
  pageLabel: string;
  /** 选中条内容（计数/动作/警告），selected 非空且列表态时渲染。 */
  bar: (selected: ReadonlyMap<string, TItem>, ctx: SurfaceCtx<TItem, TQuery>) => ReactNode;
};

/** 详情 pane 槽的入参：与翻单契约接好线的导航面与出口。 */
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
  /** 换单与关闭详情的路径前缀（如 /tickets）。 */
  basePath: string;
  parseQuery: (params: URLSearchParams) => TQuery;
  useList: (query: TQuery) => SurfaceListSlice<TItem>;
  title: string;
  /** 副标题；处理态把这行纵向预算让给详情。 */
  subtitle: ReactNode;
  headerActions?: (ctx: SurfaceCtx<TItem, TQuery>) => ReactNode;
  /** 筛选维度槽：处理态折叠时整体收起，筛选值仍在 URL 里。 */
  filters: (ctx: SurfaceCtx<TItem, TQuery>) => ReactNode;
  /** 收起态摘要用的「有几个筛选条件在生效」。 */
  activeFilterCount: (query: TQuery) => number;
  columns: ReadonlyArray<SurfaceColumn<TItem, TQuery>>;
  emptyState: {
    icon: ReactNode;
    title: string;
    description: (query: TQuery) => ReactNode;
  };
  /** 列表行 → 窄列行（时间槽语义由 adapter 定）。 */
  narrowItem: (item: TItem) => NarrowListItem;
  renderDetail: (props: SurfaceDetailProps) => ReactNode;
  selection?: SurfaceSelection<TItem, TQuery>;
  /** 行高亮（如新建成功后），不给即无高亮。 */
  isRowHighlighted?: (item: TItem) => boolean;
  dialogs?: (ctx: SurfaceCtx<TItem, TQuery>) => ReactNode;
  /** 列表态根节点的纵向间距；处理态恒为 gap-3。 */
  listGapClassName?: string;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { id: detailId } = useParams<{ id: string }>();
  const { query, searchDraft, setSearchDraft, submitSearch, setParam, setParams } =
    useTicketListUrl(parseQuery);
  // 处理态的筛选器折叠：默认收起（屏幕预算给详情），展开后保持展开
  const [filtersOpen, setFiltersOpen] = useState(false);
  // selection: id → item，跨页存活（翻页替换 items 不丢选择）
  const [selected, setSelected] = useState<ReadonlyMap<string, TItem>>(new Map());

  const detailOpen = detailId !== undefined;
  const list = useList(query);
  const items = list.items;
  const total = list.total;

  /** 换单路径：筛选串随车带走；处理态内 replace 让 Back 回到进入详情前那一步。 */
  // select/ticketPath 的引用稳定是下方 SurfaceRow memo 生效的前提。
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

  // 详情的翻单面：当前页切片里的前后单（行序 = adapter 列表序）+ 页边界
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

      {/* 处理态默认收起筛选器：URL 里的筛选值不变，只是不占屏 */}
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
        // 处理态：窄列 + 详情。窄屏 (<1024px) 无 lg → 详情占满，窄列让位
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
      // 筛选串随车带走，返回列表时上下文不丢
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
