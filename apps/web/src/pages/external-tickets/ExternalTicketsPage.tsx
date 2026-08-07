import {
  EXTERNAL_TICKET_SORT_FIELDS,
  type ExternalTicketSortField,
  TICKET_STATUS_LABELS,
  TICKET_STATUSES,
  type TicketExportFormat,
  type TicketStatus,
} from "@insuredesk/shared";
import { keepPreviousData } from "@tanstack/react-query";
import { AlertCircle, Download, Inbox, Search, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { detailNeighbors } from "@/pages/tickets/detail-navigation";
import { MultiSelectFilter } from "@/pages/tickets/MultiSelectFilter";
import { ExternalTicketDetailPane } from "./ExternalTicketDetailPane";
import { ExternalTicketFieldOrderDialog } from "./ExternalTicketFieldOrderDialog";
import { ExternalTicketListPane } from "./ExternalTicketListPane";
import { ExternalTicketSubmitDialog } from "./ExternalTicketSubmitDialog";
import { downloadExternalTicketExport } from "./external-ticket-export";
import { FeedbackDateRangePicker } from "./FeedbackDateRangePicker";

/**
 * 外部端主页：左列表右详情的主从单页（/external-tickets 与
 * /external-tickets/:id 都渲染本页，:id 即选中）。跟进为主的外部方进来
 * 一级列表默认按反馈时间倒序，新公开回复用持久化徽标提示；点行右栏即换，
 * 永不跳页；新建是顶部按钮唤起对话框，提交成功自动选中新单。
 *
 * 窄屏（<lg）主从不并存：列表占满，点行进详情，详情头部给返回键。
 * 筛选（状态/关键词/含已完结）与分页住在 URL query 里，选中住在 path 里，
 * 深链与刷新都不丢上下文。
 */

const PAGE_SIZE = 20;

function toDateParam(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** URL → 查询参数；单个参数畸形只退回它自己的缺省，不连坐其他筛选。 */
function parseQuery(params: URLSearchParams) {
  const rawStatus = params.get("status")?.split(",").filter(Boolean) ?? [];
  const status = rawStatus.filter((value): value is TicketStatus =>
    TICKET_STATUSES.includes(value as TicketStatus),
  );
  const completionStatusId = params.get("completion")?.split(",").filter(Boolean) ?? [];
  const page = Math.max(1, Number(params.get("page")) || 1);
  const rawSort = params.get("sort");
  const sortBy = EXTERNAL_TICKET_SORT_FIELDS.includes(rawSort as ExternalTicketSortField)
    ? (rawSort as ExternalTicketSortField)
    : "feedbackTime";
  return {
    status,
    completionStatusId,
    search: params.get("q") ?? "",
    feedbackFrom: params.get("from") ?? "",
    feedbackTo: params.get("to") ?? "",
    sortBy,
    sortOrder: params.get("order") === "asc" ? ("asc" as const) : ("desc" as const),
    page,
  };
}

/** 宽屏（主从同屏）才有"着陆即选中"的意义；jsdom 没有 matchMedia，按窄屏处理。 */
function isMasterDetailViewport() {
  return (
    typeof window.matchMedia === "function" && window.matchMedia("(min-width: 1024px)").matches
  );
}

export function ExternalTicketsPage() {
  const { id: selectedId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const query = parseQuery(searchParams);
  const [searchDraft, setSearchDraft] = useState(query.search);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [fieldOrderOpen, setFieldOrderOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    setSearchDraft(query.search);
  }, [query.search]);

  const listQuery = trpc.externalTicket.list.useQuery(
    {
      status: query.status.length > 0 ? query.status : undefined,
      completionStatusId:
        query.completionStatusId.length > 0 ? query.completionStatusId : undefined,
      search: query.search || undefined,
      includeCompleted: true,
      feedbackFrom: query.feedbackFrom
        ? new Date(`${query.feedbackFrom}T00:00:00.000`).toISOString()
        : undefined,
      feedbackTo: query.feedbackTo
        ? new Date(`${query.feedbackTo}T23:59:59.999`).toISOString()
        : undefined,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
      offset: (query.page - 1) * PAGE_SIZE,
      limit: PAGE_SIZE,
    },
    { placeholderData: keepPreviousData },
  );

  const items = listQuery.data?.items ?? [];
  const total = listQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const completionStatusOptions = trpc.completionStatus.filterOptions.useQuery().data ?? [];

  // 详情的 ↑/↓ 走当前页切片里的前后单（行序即服务端排定的序）
  const { prev: prevTicketId, next: nextTicketId } = detailNeighbors(items, selectedId);

  /** 选中单的路径：id 住 path，筛选参数随链接带走。 */
  function ticketPath(ticketId: string) {
    return `/external-tickets/${ticketId}${location.search}`;
  }

  // 新搜索在桌面仅命中一单时自动打开；普通着陆始终先展示一级列表。
  useEffect(() => {
    const first = items[0];
    if (
      selectedId !== undefined ||
      !query.search ||
      listQuery.isPlaceholderData ||
      items.length !== 1 ||
      !first ||
      !isMasterDetailViewport()
    ) {
      return;
    }
    navigate(`/external-tickets/${first.id}${location.search}`, { replace: true });
  }, [selectedId, items, query.search, listQuery.isPlaceholderData, location.search, navigate]);

  /** 设置/清除一个 URL 参数；筛选变化回到第 1 页。 */
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

  function setFeedbackRange(range: { from?: Date; to?: Date }) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (range.from && range.to) {
        next.set("from", toDateParam(range.from));
        next.set("to", toDateParam(range.to));
      } else {
        next.delete("from");
        next.delete("to");
      }
      next.delete("page");
      return next;
    });
  }

  function applySearch(value: string) {
    const next = new URLSearchParams(location.search);
    const trimmed = value.trim();
    if (trimmed) next.set("q", trimmed);
    else next.delete("q");
    next.delete("page");
    navigate(`/external-tickets${next.toString() ? `?${next.toString()}` : ""}`);
  }

  function setSort(sortBy: ExternalTicketSortField) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      const nextOrder = query.sortBy === sortBy && query.sortOrder === "desc" ? "asc" : "desc";
      next.set("sort", sortBy);
      next.set("order", nextOrder);
      next.delete("page");
      return next;
    });
  }

  async function handleExport(format: TicketExportFormat) {
    setExporting(true);
    try {
      await downloadExternalTicketExport(
        {
          status: query.status.length > 0 ? query.status : undefined,
          completionStatusId:
            query.completionStatusId.length > 0 ? query.completionStatusId : undefined,
          search: query.search || undefined,
          feedbackFrom: query.feedbackFrom
            ? new Date(`${query.feedbackFrom}T00:00:00.000`).toISOString()
            : undefined,
          feedbackTo: query.feedbackTo
            ? new Date(`${query.feedbackTo}T23:59:59.999`).toISOString()
            : undefined,
          sortBy: query.sortBy,
          sortOrder: query.sortOrder,
        },
        format,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "导出失败");
    } finally {
      setExporting(false);
    }
  }

  /** 首次选中 push（Back 回到无选中），已选中后换单 replace（翻单是扫描动作）。 */
  function select(ticketId: string) {
    navigate(ticketPath(ticketId), { replace: selectedId !== undefined });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">我的工单</h1>
          <p className="text-sm text-muted-foreground">
            默认按反馈时间倒序，有客服新回复的工单显示徽标。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" disabled={exporting}>
                <Download />
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
          <Button variant="outline" onClick={() => setFieldOrderOpen(true)}>
            <SlidersHorizontal />
            字段顺序
          </Button>
          <Button onClick={() => setSubmitOpen(true)}>新建工单</Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <MultiSelectFilter
          label="状态"
          values={query.status}
          options={TICKET_STATUSES.map((status) => ({
            value: status,
            label: TICKET_STATUS_LABELS[status],
          }))}
          onChange={(values) => setParam("status", values.length > 0 ? values.join(",") : null)}
        />
        <MultiSelectFilter
          label="完结状态"
          values={query.completionStatusId}
          options={completionStatusOptions.map((option) => ({
            value: option.id,
            label: option.active ? option.name : `${option.name}（已停用）`,
          }))}
          onChange={(values) => setParam("completion", values.length > 0 ? values.join(",") : null)}
        />
        <FeedbackDateRangePicker
          value={{
            from: query.feedbackFrom ? new Date(`${query.feedbackFrom}T00:00:00`) : undefined,
            to: query.feedbackTo ? new Date(`${query.feedbackTo}T00:00:00`) : undefined,
          }}
          onChange={setFeedbackRange}
        />
        <form
          className="relative"
          onSubmit={(event) => {
            event.preventDefault();
            applySearch(searchDraft);
          }}
        >
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={searchDraft}
            onChange={(event) => {
              const value = event.target.value;
              setSearchDraft(value);
              if (value === "" && query.search) applySearch("");
            }}
            placeholder="搜索已授权字段"
            className="h-8 w-60 pl-8"
          />
        </form>
      </div>

      {listQuery.error ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>工单列表加载失败</AlertTitle>
          <AlertDescription>{listQuery.error.message}</AlertDescription>
        </Alert>
      ) : (
        <div
          className={cn(
            "grid min-h-0 flex-1 grid-cols-1 gap-3",
            selectedId !== undefined && "lg:grid-cols-[minmax(14rem,1fr)_minmax(0,3fr)]",
          )}
        >
          <div
            className={cn(
              "min-h-0 flex-col rounded-md border",
              selectedId !== undefined ? "hidden lg:flex" : "flex",
            )}
          >
            {!listQuery.isLoading && items.length === 0 ? (
              <Empty className="border-0">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Inbox />
                  </EmptyMedia>
                  <EmptyTitle>没有工单</EmptyTitle>
                  <EmptyDescription>
                    {query.status.length > 0 ||
                    query.completionStatusId.length > 0 ||
                    query.search ||
                    query.feedbackFrom ||
                    query.feedbackTo ? (
                      "当前筛选条件下没有工单，换个条件试试。"
                    ) : (
                      <>点右上角「新建工单」，把客户反馈原文交给客服团队。</>
                    )}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <ExternalTicketListPane
                items={items}
                isLoading={listQuery.isLoading}
                selectedId={selectedId}
                visibleFields={listQuery.data?.visibleFields ?? []}
                detailVisibleFields={listQuery.data?.detailVisibleFields ?? []}
                sort={{ by: query.sortBy, order: query.sortOrder }}
                onSort={setSort}
                onSelect={select}
              />
            )}
          </div>

          {selectedId !== undefined && (
            <div className="flex min-h-0 flex-col rounded-md border">
              <ExternalTicketDetailPane
                ticketId={selectedId}
                neighbors={{ prev: prevTicketId, next: nextTicketId }}
                onSwitch={select}
                onClose={() => navigate(`/external-tickets${location.search}`)}
              />
            </div>
          )}
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

      <ExternalTicketSubmitDialog
        open={submitOpen}
        onOpenChange={setSubmitOpen}
        onSubmitted={(ticket) => {
          setSubmitOpen(false);
          navigate(ticketPath(ticket.id));
        }}
      />
      <ExternalTicketFieldOrderDialog open={fieldOrderOpen} onOpenChange={setFieldOrderOpen} />
    </div>
  );
}
