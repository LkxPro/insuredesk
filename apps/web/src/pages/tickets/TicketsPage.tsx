import {
  BATCH_ASSIGN_LIMIT,
  COMPLAINT_LEVELS,
  type CreatedRangeQuery,
  DEFAULT_TICKET_SOURCE_FILTER,
  isTicketInFlight,
  TICKET_DISPLAY_STATUSES,
  TICKET_FIELDS,
  TICKET_SOURCE_LABELS,
  TICKET_SOURCES,
  TICKET_STATUS_LABELS,
  type TicketExportFormat,
  type TicketListQuery,
  type TicketSortField,
  ticketListInputSchema,
} from "@insuredesk/shared";
import { keepPreviousData } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Download,
  Plus,
  Search,
  SlidersHorizontal,
  Ticket,
  Upload,
  UserPlus,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { formatDateTime } from "@/lib/datetime";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { type AssignTarget, AssignTicketDialog } from "./AssignTicketDialog";
import { AutoAssignDialog } from "./AutoAssignDialog";
import { CreatedRangeFilter } from "./CreatedRangeFilter";
import { MultiSelectFilter } from "./MultiSelectFilter";
import { type ResolveTarget, ResolveTicketDialog } from "./ResolveTicketDialog";
import { StatusBadge } from "./StatusBadge";
import { TicketCreateDialog } from "./TicketCreateDialog";
import { TicketDetailPane } from "./TicketDetailPane";
import { TicketImportDialog } from "./TicketImportDialog";
import { TicketNarrowList } from "./TicketNarrowList";
import { downloadTicketExport } from "./ticket-export";

/**
 * 工单管理 list: filters (状态 incl. the computed statuses, 渠道, 完结状态,
 * 投诉等级, 来源), 工单号/客户姓名/保单号/电话 search, 创建时间/处理时限 sort, and
 * pagination. All list state lives in the URL — same deep-link treatment as
 * /tickets/new — and is parsed through the shared ticketListInputSchema, so an
 * edited query string degrades to defaults instead of crashing. Data scope is
 * enforced server-side; this page renders whatever the viewer may see.
 *
 * 两态主从分栏 (issue #164): /tickets 是默认态——全宽表格，筛选/批量操作/导入
 * 导出原样在位。/tickets/:id 是处理态——同一份列表数据压缩成左侧窄列（客户名/
 * 状态/处理时限），右侧 ~75% 是 TicketDetailPane。压缩态下筛选器收起为一行摘要
 * ＋展开按钮（筛选值仍在 URL 里，切态不丢），批量选择与导入导出退场：处理态的
 * 屏幕预算属于详情。窄屏 (<1024px) 降级为详情覆盖窄列，桌面优先。
 *
 * Creation stays a modal dialog over this page, driven by the /tickets/new
 * route (`createOpen`), shown only to holders of ticket.create. The filter
 * query string rides along into /tickets/:id and back, so closing the detail
 * lands on the list exactly as it was.
 *
 * Assignment adds two permission-gated entry points: a per-row 分配/改派
 * action (ticket.assign) and multi-select checkboxes feeding 批量分配
 * (ticket.batch_assign). Selection is kept as id → AssignTarget so it survives
 * paging; completed tickets are terminal and not selectable.
 *
 * The 操作 cell is a hover-revealed quick-action strip: 分配/改派 and 自动分配
 * (ticket.assign, non-terminal rows) plus 完结 (ticket.process, in-flight
 * rows) jump straight into their dialogs without opening the detail — the
 * same gates the detail header applies. The buttons stay in the DOM (and the
 * strip reveals on focus) so keyboard users reach them too.
 */

const BASE_COLUMN_COUNT = 10;

/**
 * URL query string → validated list query. Each param is salvaged on its own,
 * so one malformed value (a hand-edited page, say) falls back to its default
 * without silently dropping the other filters. Filter params carry
 * comma-separated multi-selections; a param's absence means 默认（状态等不过
 * 滤，来源按 schema 缺省排除归档单）。
 */
function parseListQuery(params: URLSearchParams): TicketListQuery {
  const multi = (key: string) =>
    params.has(key) ? params.get(key)?.split(",").filter(Boolean) : undefined;
  const candidate = {
    status: multi("status"),
    channelId: multi("channel"),
    categoryId: multi("category"),
    completionStatusId: multi("completionStatus"),
    complaintLevel: multi("level"),
    source: multi("source"),
    search: params.get("q") ?? undefined,
    createdFrom: params.get("createdFrom") ?? undefined,
    createdTo: params.get("createdTo") ?? undefined,
    sortBy: params.get("sortBy") ?? undefined,
    sortOrder: params.get("sortOrder") ?? undefined,
    page: params.has("page") ? Number(params.get("page")) : undefined,
  };
  const fields = ticketListInputSchema.shape;
  return ticketListInputSchema.parse(
    Object.fromEntries(
      Object.entries(candidate).map(([key, value]) => [
        key,
        fields[key as keyof typeof fields].safeParse(value).success ? value : undefined,
      ]),
    ),
  );
}

/** Selection → URL value; null removes the param (回到默认). */
function serializeSelection(
  values: readonly string[],
  defaultValues: readonly string[],
): string | null {
  if (values.length === 0) {
    // 空选 = 全部：对无默认的维度即默认态，不写入；对来源偏离默认，写空值标记
    return defaultValues.length === 0 ? null : "";
  }
  const sameSet =
    values.length === defaultValues.length && values.every((v) => defaultValues.includes(v));
  return sameSet ? null : values.join(",");
}

/** The one placeholder for 未填写 cells — unknown, not empty. */
function Unknown() {
  return <span className="text-muted-foreground">—</span>;
}

/**
 * 保单号列：首个保单号 + 多于一个时的 +N 徽标，点徽标弹出全部保单号。徽标只显
 * 示"还有几个"，列宽由首值决定、不被整串撑爆。空数组沿用 Unknown 未填写样式。
 */
function PolicyNumbersCell({ policyNumbers }: { policyNumbers: readonly string[] }) {
  if (policyNumbers.length === 0) {
    return <Unknown />;
  }
  const [first, ...rest] = policyNumbers;
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      {first}
      {rest.length > 0 && (
        <Popover>
          {/* stopPropagation: 展开保单号不应顺带打开行详情 */}
          <PopoverTrigger asChild onClick={(event) => event.stopPropagation()}>
            <Badge
              asChild
              variant="secondary"
              className="cursor-pointer tabular-nums"
              aria-label={`还有 ${rest.length} 个保单号`}
            >
              <button type="button">+{rest.length}</button>
            </Badge>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-auto max-w-72 p-2"
            onClick={(event) => event.stopPropagation()}
          >
            <ul className="flex flex-col gap-1 text-sm">
              {policyNumbers.map((policyNumber) => (
                <li key={policyNumber} className="break-all">
                  {policyNumber}
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      )}
    </span>
  );
}

function SortHead({
  field,
  label,
  query,
  onToggle,
}: {
  field: TicketSortField;
  label: string;
  query: TicketListQuery;
  onToggle: (field: TicketSortField) => void;
}) {
  const active = query.sortBy === field;
  const Icon = active ? (query.sortOrder === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <Button variant="ghost" size="sm" className="-ml-3 h-8" onClick={() => onToggle(field)}>
      {label}
      <Icon data-icon="inline-end" className={active ? "" : "text-muted-foreground"} />
    </Button>
  );
}

/** Layout-shaped placeholder rows while the list query is in flight. */
function ListSkeletonRows({ columnCount }: { columnCount: number }) {
  const cells = Array.from({ length: columnCount }, (_, index) => index);
  return (
    <>
      {[0, 1, 2, 3, 4].map((row) => (
        <TableRow key={row}>
          {cells.map((cell) => (
            <TableCell key={cell}>
              <Skeleton className="h-4 w-full max-w-24" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

export function TicketsPage({ createOpen = false }: { createOpen?: boolean }) {
  const { hasPermission } = useAuth();
  const navigate = useNavigate();
  // /tickets/:id renders this same page with the detail dialog open
  const { id: detailId } = useParams<{ id: string }>();
  const location = useLocation();
  const canCreate = hasPermission("ticket.create");
  const canAssign = hasPermission("ticket.assign");
  const canBatchAssign = hasPermission("ticket.batch_assign");
  const canProcess = hasPermission("ticket.process");
  const canExport = hasPermission("ticket.export");
  const canImport = hasPermission("ticket.import");
  const canRowActions = canAssign || canProcess;

  const [searchParams, setSearchParams] = useSearchParams();
  const query = parseListQuery(searchParams);
  const [searchDraft, setSearchDraft] = useState(query.search ?? "");

  // 批量分配 selection: id → target so it survives paging (the dialog needs
  // more than the id, and page 2 replaces `items`)
  const [selected, setSelected] = useState<ReadonlyMap<string, AssignTarget>>(new Map());
  const [singleTarget, setSingleTarget] = useState<AssignTarget | null>(null);
  const [resolveTarget, setResolveTarget] = useState<ResolveTarget | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);
  const [autoTargets, setAutoTargets] = useState<AssignTarget[] | null>(null);
  const [exporting, setExporting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  // 建单成功留在列表：新建行高亮，直到下一次建单或离开本页
  const [highlightId, setHighlightId] = useState<string | null>(null);
  // 处理态的筛选器折叠：默认收起（屏幕预算给详情），展开后保持展开
  const [filtersOpen, setFiltersOpen] = useState(false);

  const detailOpen = detailId !== undefined;
  /** 收起态摘要用的「有几个筛选条件在生效」——搜索词与创建时间区间各算一个。 */
  const activeFilterCount = [
    query.status?.length,
    query.channelId?.length,
    query.categoryId?.length,
    query.completionStatusId?.length,
    query.complaintLevel?.length,
    query.search ? 1 : 0,
    query.createdFrom || query.createdTo ? 1 : 0,
  ].filter((count) => (count ?? 0) > 0).length;

  const listQuery = trpc.ticket.list.useQuery(query, { placeholderData: keepPreviousData });
  // 目录筛选全列目录项（停用项标注），选停用项仍能查到其存量工单
  const channelOptions = trpc.channel.filterOptions.useQuery().data ?? [];
  const categoryOptions = trpc.ticketCategory.filterOptions.useQuery().data ?? [];
  const completionStatusOptions = trpc.completionStatus.filterOptions.useQuery().data ?? [];

  /** Set/clear one URL param; filter changes restart from page 1. */
  function setParam(key: string, value: string | null, { resetPage = true } = {}) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value === null) {
        next.delete(key);
      } else {
        next.set(key, value);
      }
      if (resetPage) {
        next.delete("page");
      }
      return next;
    });
  }

  /** 创建时间区间是一对参数，须同进同出，否则中间态会筛出半开区间。 */
  function setCreatedRange(range: CreatedRangeQuery) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const key of ["createdFrom", "createdTo"] as const) {
        const value = range[key];
        if (value === undefined) {
          next.delete(key);
        } else {
          next.set(key, value);
        }
      }
      next.delete("page");
      return next;
    });
  }

  function toggleSort(field: TicketSortField) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("sortBy", field);
      if (query.sortBy === field) {
        next.set("sortOrder", query.sortOrder === "desc" ? "asc" : "desc");
      } else {
        // 处理时限 defaults to soonest-first — that's the queue-working order
        next.set("sortOrder", field === "dueAt" ? "asc" : "desc");
      }
      next.delete("page");
      return next;
    });
  }

  const items = listQuery.data?.items ?? [];
  const total = listQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / query.pageSize));

  // QuickLook 键盘浏览: the detail dialog's ↑/↓ walk this page's rows in
  // their listed (filter + sort) order. Edges stop dead — no page turn — and
  // a detail deep-linked from outside the current page has no neighbours.
  const detailIndex = detailId === undefined ? -1 : items.findIndex((t) => t.id === detailId);
  const prevTicketId = detailIndex > 0 ? (items[detailIndex - 1]?.id ?? null) : null;
  const nextTicketId = detailIndex === -1 ? null : (items[detailIndex + 1]?.id ?? null);
  const columnCount = BASE_COLUMN_COUNT + (canBatchAssign ? 1 : 0) + (canRowActions ? 1 : 0);

  type ListItem = (typeof items)[number];

  function toTarget(ticket: ListItem): AssignTarget {
    return {
      id: ticket.id,
      workOrderNumber: ticket.workOrderNumber,
      assigneeId: ticket.assigneeId,
      assigneeName: ticket.assigneeName,
      dueAt: ticket.dueAt,
    };
  }

  function toggleSelected(ticket: ListItem) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(ticket.id)) {
        next.delete(ticket.id);
      } else {
        next.set(ticket.id, toTarget(ticket));
      }
      return next;
    });
  }

  // completed is terminal — never selectable for assignment
  const selectableItems = items.filter((ticket) => ticket.status !== "completed");
  const allPageSelected =
    selectableItems.length > 0 && selectableItems.every((ticket) => selected.has(ticket.id));
  const selectedHasAssigned = [...selected.values()].some((target) => target.assigneeId !== null);

  /** 导出当前筛选结果 — the server re-applies scope and filters. */
  async function handleExport(format: TicketExportFormat) {
    setExporting(true);
    try {
      await downloadTicketExport(query, format);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "导出失败");
    } finally {
      setExporting(false);
    }
  }

  function togglePageSelection() {
    setSelected((prev) => {
      const next = new Map(prev);
      for (const ticket of selectableItems) {
        if (allPageSelected) {
          next.delete(ticket.id);
        } else {
          next.set(ticket.id, toTarget(ticket));
        }
      }
      return next;
    });
  }

  return (
    <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", detailOpen ? "gap-3" : "gap-6")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">工单管理</h1>
          {/* 处理态把这行纵向预算让给详情 */}
          {!detailOpen && (
            <p className="text-sm text-muted-foreground">客诉工单的创建、分配与跟进。</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {canExport && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" disabled={exporting}>
                  <Download data-icon="inline-start" />
                  {exporting ? "导出中…" : "导出"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => handleExport("xlsx")}>
                  导出 Excel (.xlsx)
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => handleExport("csv")}>
                  导出 CSV (.csv)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {canImport && (
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload data-icon="inline-start" />
              导入
            </Button>
          )}
          {canCreate && (
            <Button asChild>
              <Link to="/tickets/new">
                <Plus data-icon="inline-start" />
                新建工单
              </Link>
            </Button>
          )}
        </div>
      </div>

      {/* 处理态默认收起筛选器：URL 里的筛选值不变，只是不占屏 */}
      {detailOpen && !filtersOpen && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>
            共 {total} 条
            {activeFilterCount > 0 ? ` · ${activeFilterCount} 个筛选条件` : " · 未筛选"}
          </span>
          <Button variant="outline" size="sm" onClick={() => setFiltersOpen(true)}>
            <SlidersHorizontal data-icon="inline-start" />
            展开筛选
          </Button>
        </div>
      )}

      {(!detailOpen || filtersOpen) && (
        <div className="flex flex-wrap items-center gap-2">
          {detailOpen && (
            <Button variant="ghost" size="sm" onClick={() => setFiltersOpen(false)}>
              收起筛选
            </Button>
          )}
          <MultiSelectFilter
            label="状态"
            values={query.status ?? []}
            options={TICKET_DISPLAY_STATUSES.map((status) => ({
              value: status,
              label: TICKET_STATUS_LABELS[status],
            }))}
            onChange={(values) => setParam("status", serializeSelection(values, []))}
          />
          <MultiSelectFilter
            label={TICKET_FIELDS.channelId.overrides.listLabel}
            values={query.channelId ?? []}
            options={channelOptions.map((channel) => ({
              value: channel.id,
              label: channel.active ? channel.name : `${channel.name}（已停用）`,
            }))}
            onChange={(values) => setParam("channel", serializeSelection(values, []))}
          />
          <MultiSelectFilter
            label={TICKET_FIELDS.categoryId.overrides.listLabel}
            values={query.categoryId ?? []}
            options={categoryOptions.map((category) => ({
              value: category.id,
              label: category.active ? category.name : `${category.name}（已停用）`,
            }))}
            onChange={(values) => setParam("category", serializeSelection(values, []))}
          />
          <MultiSelectFilter
            label={TICKET_FIELDS.completionStatusId.label}
            values={query.completionStatusId ?? []}
            options={completionStatusOptions.map((status) => ({
              value: status.id,
              label: status.active ? status.name : `${status.name}（已停用）`,
            }))}
            onChange={(values) => setParam("completionStatus", serializeSelection(values, []))}
          />
          <MultiSelectFilter
            label={TICKET_FIELDS.complaintLevel.label}
            values={query.complaintLevel ?? []}
            options={COMPLAINT_LEVELS.map((level) => ({ value: level, label: level }))}
            onChange={(values) => setParam("level", serializeSelection(values, []))}
          />
          {/* 来源有缺省（排除归档单）：全选四个来源 ≠ 缺省，仍写入 URL */}
          <MultiSelectFilter
            label="来源"
            values={query.source}
            options={TICKET_SOURCES.map((source) => ({
              value: source,
              label: TICKET_SOURCE_LABELS[source],
            }))}
            onChange={(values) =>
              setParam("source", serializeSelection(values, DEFAULT_TICKET_SOURCE_FILTER))
            }
          />
          <CreatedRangeFilter
            range={{ createdFrom: query.createdFrom, createdTo: query.createdTo }}
            onChange={setCreatedRange}
          />
          <form
            className="relative"
            onSubmit={(event) => {
              event.preventDefault();
              setParam("q", searchDraft.trim() || null);
            }}
          >
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder="工单号 / 客户姓名 / 保单号 / 电话"
              className="h-8 w-60 pl-8"
            />
          </form>
        </div>
      )}

      {!detailOpen && canBatchAssign && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/50 px-3 py-2 text-sm">
          <span>已选 {selected.size} 个工单</span>
          <Button
            size="sm"
            disabled={selected.size > BATCH_ASSIGN_LIMIT}
            onClick={() => setBatchOpen(true)}
          >
            <UserPlus data-icon="inline-start" />
            批量分配
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={selectedHasAssigned || selected.size > BATCH_ASSIGN_LIMIT}
            onClick={() => setAutoTargets([...selected.values()])}
          >
            <Zap data-icon="inline-start" />
            按排班自动分配
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Map())}>
            清除选择
          </Button>
          {selected.size > BATCH_ASSIGN_LIMIT && (
            <span className="text-destructive">
              一次最多分配 {BATCH_ASSIGN_LIMIT} 个，请减少选择
            </span>
          )}
          {selectedHasAssigned && (
            <span className="text-muted-foreground">自动分配仅适用于未分配工单</span>
          )}
        </div>
      )}

      {listQuery.error ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>工单列表加载失败</AlertTitle>
          <AlertDescription>{listQuery.error.message}</AlertDescription>
        </Alert>
      ) : detailOpen ? (
        // 处理态：窄列 + 详情。窄屏 (<1024px) 无 lg → 详情占满，窄列让位
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(14rem,1fr)_minmax(0,3fr)]">
          <div className="hidden min-h-0 rounded-md border lg:flex lg:flex-col">
            <TicketNarrowList
              items={items}
              selectedId={detailId ?? ""}
              onSelect={(id) => navigate(`/tickets/${id}${location.search}`, { replace: true })}
            />
          </div>
          <div className="flex min-h-0 flex-col rounded-md border">
            <TicketDetailPane
              ticketId={detailId ?? ""}
              neighbors={{ prev: prevTicketId, next: nextTicketId }}
              // replace: 翻单是扫描动作，Back 应回到进入详情前那一步，不重放每一站
              onSwitch={(id) => navigate(`/tickets/${id}${location.search}`, { replace: true })}
              onClose={() => navigate(`/tickets${location.search}`)}
            />
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded-md border">
          <Table>
            {/* 表头随行滚动会丢失列语义，钉在滚动容器顶部 */}
            <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-background">
              <TableRow>
                {canBatchAssign && (
                  <TableHead className="w-10">
                    <Checkbox
                      aria-label="选择本页全部工单"
                      checked={allPageSelected}
                      disabled={selectableItems.length === 0}
                      onCheckedChange={togglePageSelection}
                    />
                  </TableHead>
                )}
                <TableHead>工单号</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>{TICKET_FIELDS.customerName.label}</TableHead>
                <TableHead>{TICKET_FIELDS.policyNumbers.label}</TableHead>
                <TableHead>{TICKET_FIELDS.channelId.overrides.listLabel}</TableHead>
                <TableHead>{TICKET_FIELDS.complaintLevel.label}</TableHead>
                <TableHead>来源</TableHead>
                <TableHead>责任人</TableHead>
                <TableHead>
                  <SortHead
                    field="createdAt"
                    label="创建时间"
                    query={query}
                    onToggle={toggleSort}
                  />
                </TableHead>
                <TableHead>
                  <SortHead field="dueAt" label="处理时限" query={query} onToggle={toggleSort} />
                </TableHead>
                {canRowActions && <TableHead className="w-40">操作</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {listQuery.isLoading ? (
                <ListSkeletonRows columnCount={columnCount} />
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columnCount} className="p-0">
                    <Empty className="border-0">
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <Ticket />
                        </EmptyMedia>
                        <EmptyTitle>暂无匹配的工单</EmptyTitle>
                        <EmptyDescription>调整筛选条件，或新建一条工单。</EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  </TableCell>
                </TableRow>
              ) : (
                items.map((ticket) => (
                  <TableRow
                    key={ticket.id}
                    data-highlighted={ticket.id === highlightId || undefined}
                    className="group cursor-pointer data-[highlighted]:bg-primary/10 data-[highlighted]:hover:bg-primary/15"
                    // The filter query string rides to the detail and back
                    onClick={() => navigate(`/tickets/${ticket.id}${location.search}`)}
                  >
                    {canBatchAssign && (
                      // onClick swallows the row's navigation click; the checkbox inside is keyboard-operable
                      <TableCell onClick={(event) => event.stopPropagation()}>
                        <Checkbox
                          aria-label={`选择工单 ${ticket.workOrderNumber}`}
                          checked={selected.has(ticket.id)}
                          disabled={ticket.status === "completed"}
                          onCheckedChange={() => toggleSelected(ticket)}
                        />
                      </TableCell>
                    )}
                    <TableCell>
                      <Link
                        to={`/tickets/${ticket.id}${location.search}`}
                        className="font-medium hover:underline"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {ticket.workOrderNumber}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={ticket.displayStatus} />
                    </TableCell>
                    <TableCell>{ticket.customerName ?? <Unknown />}</TableCell>
                    <TableCell>
                      <PolicyNumbersCell policyNumbers={ticket.policyNumbers} />
                    </TableCell>
                    <TableCell>{ticket.channel ?? <Unknown />}</TableCell>
                    <TableCell>{ticket.complaintLevel ?? <Unknown />}</TableCell>
                    <TableCell>{TICKET_SOURCE_LABELS[ticket.source]}</TableCell>
                    <TableCell>
                      {ticket.assigneeName ?? <span className="text-muted-foreground">未分配</span>}
                    </TableCell>
                    <TableCell>{formatDateTime(ticket.createdAt)}</TableCell>
                    <TableCell>
                      {/* dueAt null = 特急不设时限 when a level exists, 未定级 otherwise */}
                      {ticket.dueAt ? (
                        formatDateTime(ticket.dueAt)
                      ) : ticket.complaintLevel ? (
                        <span className="text-muted-foreground">不设时限</span>
                      ) : (
                        <Unknown />
                      )}
                    </TableCell>
                    {canRowActions && (
                      <TableCell>
                        {/* stopPropagation everywhere: a quick action must
                            never double as the row's open-detail click */}
                        <div className="flex items-center whitespace-nowrap opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                          {canAssign && ticket.status !== "completed" && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setSingleTarget(toTarget(ticket));
                                }}
                              >
                                {ticket.assigneeId ? "改派" : "分配"}
                              </Button>
                              {ticket.assigneeId === null && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setAutoTargets([toTarget(ticket)]);
                                  }}
                                >
                                  自动分配
                                </Button>
                              )}
                            </>
                          )}
                          {canProcess && isTicketInFlight(ticket.status) && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(event) => {
                                event.stopPropagation();
                                setResolveTarget({
                                  id: ticket.id,
                                  workOrderNumber: ticket.workOrderNumber,
                                });
                              }}
                            >
                              完结
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {!listQuery.error && !detailOpen && (
        <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>
            共 {total} 条 · 第 {query.page} / {totalPages} 页
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={query.page <= 1 || listQuery.isLoading}
              onClick={() => setParam("page", String(query.page - 1), { resetPage: false })}
            >
              上一页
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={query.page >= totalPages || listQuery.isLoading}
              onClick={() => setParam("page", String(query.page + 1), { resetPage: false })}
            >
              下一页
            </Button>
          </div>
        </div>
      )}

      {canCreate && (
        <TicketCreateDialog
          open={createOpen}
          onOpenChange={(open) => {
            if (!open) navigate("/tickets");
          }}
          onCreated={(ticket) => setHighlightId(ticket.id)}
        />
      )}

      {canImport && <TicketImportDialog open={importOpen} onOpenChange={setImportOpen} />}

      {canAssign && singleTarget && (
        <AssignTicketDialog
          mode="single"
          open
          onOpenChange={(open) => {
            if (!open) setSingleTarget(null);
          }}
          targets={[singleTarget]}
        />
      )}

      {canProcess && resolveTarget && (
        <ResolveTicketDialog
          open
          onOpenChange={(open) => {
            if (!open) setResolveTarget(null);
          }}
          ticket={resolveTarget}
        />
      )}

      {canBatchAssign && (
        <AssignTicketDialog
          mode="batch"
          open={batchOpen}
          onOpenChange={setBatchOpen}
          targets={[...selected.values()]}
          onAssigned={() => setSelected(new Map())}
        />
      )}

      {(canAssign || canBatchAssign) && autoTargets && (
        <AutoAssignDialog
          open
          onOpenChange={(open) => {
            if (!open) setAutoTargets(null);
          }}
          targets={autoTargets}
          onAssigned={(assignedIds) =>
            setSelected((previous) => {
              const next = new Map(previous);
              for (const id of assignedIds) next.delete(id);
              return next;
            })
          }
        />
      )}
    </div>
  );
}
