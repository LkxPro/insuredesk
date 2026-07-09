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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  BATCH_ASSIGN_LIMIT,
  CHANNELS,
  COMPLAINT_LEVELS,
  TICKET_DISPLAY_STATUSES,
  TICKET_SOURCES,
  TICKET_SOURCE_LABELS,
  TICKET_STATUS_LABELS,
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
  Plus,
  Search,
  Ticket,
  UserPlus,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { type AssignTarget, AssignTicketDialog } from "./AssignTicketDialog";
import { StatusBadge } from "./StatusBadge";
import { TicketCreateDialog } from "./TicketCreateDialog";

/**
 * 工单管理 list (issue #23): filters (状态 incl. the computed statuses, 渠道,
 * 投诉等级, 来源), 工单号/客户姓名/保单号 search, 创建时间/处理时限 sort, and
 * pagination. All list state lives in the URL — same deep-link treatment as
 * /tickets/new — and is parsed through the shared ticketListInputSchema, so an
 * edited query string degrades to defaults instead of crashing. Data scope is
 * enforced server-side; this page renders whatever the viewer may see.
 *
 * Creation stays a modal dialog over this page, driven by the /tickets/new
 * route (`createOpen`), shown only to holders of ticket.create.
 *
 * Assignment (issue #24) adds two permission-gated entry points: a per-row
 * 分配/改派 action (ticket.assign) and multi-select checkboxes feeding 批量分配
 * (ticket.batch_assign). Selection is kept as id → AssignTarget so it survives
 * paging; completed tickets are terminal and not selectable.
 */

const BASE_COLUMN_COUNT = 10;

/**
 * URL query string → validated list query. Each param is salvaged on its own,
 * so one malformed value (a hand-edited page, say) falls back to its default
 * without silently dropping the other filters.
 */
function parseListQuery(params: URLSearchParams): TicketListQuery {
  const candidate = {
    status: params.get("status") ?? undefined,
    channel: params.get("channel") ?? undefined,
    complaintLevel: params.get("level") ?? undefined,
    source: params.get("source") ?? undefined,
    search: params.get("q") ?? undefined,
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

/** Radix Select rejects empty item values, so 全部 rides a sentinel. */
const ALL = "all";

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | undefined;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string | null) => void;
}) {
  return (
    <Select value={value ?? ALL} onValueChange={(next) => onChange(next === ALL ? null : next)}>
      <SelectTrigger className="w-[130px]" aria-label={label} size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>全部{label}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
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
  const canCreate = hasPermission("ticket.create");
  const canAssign = hasPermission("ticket.assign");
  const canBatchAssign = hasPermission("ticket.batch_assign");

  const [searchParams, setSearchParams] = useSearchParams();
  const query = parseListQuery(searchParams);
  const [searchDraft, setSearchDraft] = useState(query.search ?? "");

  // 批量分配 selection: id → target so it survives paging (the dialog needs
  // more than the id, and page 2 replaces `items`)
  const [selected, setSelected] = useState<ReadonlyMap<string, AssignTarget>>(new Map());
  const [singleTarget, setSingleTarget] = useState<AssignTarget | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);

  const listQuery = trpc.ticket.list.useQuery(query, { placeholderData: keepPreviousData });

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
  const columnCount = BASE_COLUMN_COUNT + (canBatchAssign ? 1 : 0) + (canAssign ? 1 : 0);

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
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">工单管理</h1>
          <p className="text-sm text-muted-foreground">客诉工单的创建、分配与跟进。</p>
        </div>
        {canCreate && (
          <Button asChild>
            <Link to="/tickets/new">
              <Plus data-icon="inline-start" />
              新建工单
            </Link>
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          label="状态"
          value={query.status}
          options={TICKET_DISPLAY_STATUSES.map((status) => ({
            value: status,
            label: TICKET_STATUS_LABELS[status],
          }))}
          onChange={(value) => setParam("status", value)}
        />
        <FilterSelect
          label="渠道"
          value={query.channel}
          options={CHANNELS.map((channel) => ({ value: channel, label: channel }))}
          onChange={(value) => setParam("channel", value)}
        />
        <FilterSelect
          label="投诉等级"
          value={query.complaintLevel}
          options={COMPLAINT_LEVELS.map((level) => ({ value: level, label: level }))}
          onChange={(value) => setParam("level", value)}
        />
        <FilterSelect
          label="来源"
          value={query.source}
          options={TICKET_SOURCES.map((source) => ({
            value: source,
            label: TICKET_SOURCE_LABELS[source],
          }))}
          onChange={(value) => setParam("source", value)}
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
            placeholder="工单号 / 客户姓名 / 保单号"
            className="h-8 w-60 pl-8"
          />
        </form>
      </div>

      {canBatchAssign && selected.size > 0 && (
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
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Map())}>
            清除选择
          </Button>
          {selected.size > BATCH_ASSIGN_LIMIT && (
            <span className="text-destructive">
              一次最多分配 {BATCH_ASSIGN_LIMIT} 个，请减少选择
            </span>
          )}
        </div>
      )}

      {listQuery.error ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>工单列表加载失败</AlertTitle>
          <AlertDescription>{listQuery.error.message}</AlertDescription>
        </Alert>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
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
                <TableHead>客户姓名</TableHead>
                <TableHead>保单号</TableHead>
                <TableHead>渠道</TableHead>
                <TableHead>投诉等级</TableHead>
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
                {canAssign && <TableHead className="w-16">操作</TableHead>}
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
                    className="cursor-pointer"
                    onClick={() => navigate(`/tickets/${ticket.id}`)}
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
                        to={`/tickets/${ticket.id}`}
                        className="font-medium hover:underline"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {ticket.workOrderNumber}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={ticket.displayStatus} />
                    </TableCell>
                    <TableCell>{ticket.customerName}</TableCell>
                    <TableCell>{ticket.policyNumber}</TableCell>
                    <TableCell>{ticket.channel}</TableCell>
                    <TableCell>{ticket.complaintLevel}</TableCell>
                    <TableCell>{TICKET_SOURCE_LABELS[ticket.source]}</TableCell>
                    <TableCell>
                      {ticket.assigneeName ?? <span className="text-muted-foreground">未分配</span>}
                    </TableCell>
                    <TableCell>{formatDateTime(ticket.createdAt)}</TableCell>
                    <TableCell>
                      {ticket.dueAt ? (
                        formatDateTime(ticket.dueAt)
                      ) : (
                        <span className="text-muted-foreground">不设时限</span>
                      )}
                    </TableCell>
                    {canAssign && (
                      <TableCell>
                        {ticket.status !== "completed" && (
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
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {!listQuery.error && (
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
        />
      )}

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

      {canBatchAssign && (
        <AssignTicketDialog
          mode="batch"
          open={batchOpen}
          onOpenChange={setBatchOpen}
          targets={[...selected.values()]}
          onAssigned={() => setSelected(new Map())}
        />
      )}
    </div>
  );
}
