import {
  externalTicketListInputSchema,
  TICKET_FIELDS,
  TICKET_STATUS_LABELS,
  TICKET_STATUSES,
  type TicketStatus,
} from "@insuredesk/shared";
import { keepPreviousData } from "@tanstack/react-query";
import { AlertCircle, Inbox } from "lucide-react";
import { useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { CreatedRangeFilter } from "@/components/ticket-list/CreatedRangeFilter";
import { ListSkeletonRows } from "@/components/ticket-list/ListSkeletonRows";
import { MultiSelectFilter } from "@/components/ticket-list/MultiSelectFilter";
import { PolicyNumbersCell } from "@/components/ticket-list/PolicyNumbersCell";
import { TicketExportButton } from "@/components/ticket-list/TicketExportButton";
import { TicketListFilterBar } from "@/components/ticket-list/TicketListFilterBar";
import { TicketListPagination } from "@/components/ticket-list/TicketListPagination";
import { TicketListSearch } from "@/components/ticket-list/TicketListSearch";
import { Unknown } from "@/components/ticket-list/Unknown";
import { useTicketListUrl } from "@/components/ticket-list/useTicketListUrl";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime } from "@/lib/datetime";
import { trpc } from "@/lib/trpc";
import { detailNav, useCrossPageNav } from "@/pages/tickets/detail-navigation";
import { StatusBadge } from "@/pages/tickets/StatusBadge";
import { ExternalTicketDetailPane } from "./ExternalTicketDetailPane";
import { ExternalTicketSubmitDialog } from "./ExternalTicketSubmitDialog";
import { downloadExternalTicketExport } from "./external-ticket-export";

/**
 * 外部端主页：/external-tickets 是全宽表格一级列表（筛选与分页住在 URL query
 * 里），整行点进 /external-tickets/:id 整页详情。跟进为主的外部方进来最上面
 * 是该说话的单（服务端把客服新发言的工单排在最前，列序即服务端排定的序，无
 * 列头排序）；新建是顶部按钮唤起对话框，提交成功进新单详情。
 *
 * 详情页保留翻单：nav 由同一份列表查询按当前筛选与页码算出，方向键/prev/next
 * 与越界翻页契约同内部 /tickets（detail-navigation）。筛选串随链接带走，深链
 * 与刷新都不丢上下文。
 */

const PAGE_SIZE = 20;
const COLUMN_COUNT = 7;

/** URL → 查询参数；单个参数畸形只退回它自己的缺省，不连坐其他筛选。 */
function parseQuery(params: URLSearchParams) {
  const rawStatus = params.get("status")?.split(",").filter(Boolean) ?? [];
  const status = rawStatus.filter((value): value is TicketStatus =>
    TICKET_STATUSES.includes(value as TicketStatus),
  );
  const page = Math.max(1, Number(params.get("page")) || 1);
  return {
    status,
    search: params.get("q") ?? "",
    includeCompleted: params.get("completed") === "1",
    createdFrom: salvageDateTime(params.get("createdFrom")),
    createdTo: salvageDateTime(params.get("createdTo")),
    page,
  };
}

/** 创建时间边界必须是合法 ISO 时刻，否则该边界按未筛选处理。 */
function salvageDateTime(raw: string | null) {
  return raw !== null && externalTicketListInputSchema.shape.createdFrom.safeParse(raw).success
    ? raw
    : undefined;
}

export function ExternalTicketsPage() {
  const { id: selectedId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { query, searchDraft, setSearchDraft, submitSearch, setParam, setParams } =
    useTicketListUrl(parseQuery);
  const [submitOpen, setSubmitOpen] = useState(false);

  const listQuery = trpc.externalTicket.list.useQuery(
    {
      status: query.status.length > 0 ? query.status : undefined,
      search: query.search || undefined,
      includeCompleted: query.includeCompleted,
      createdFrom: query.createdFrom,
      createdTo: query.createdTo,
      offset: (query.page - 1) * PAGE_SIZE,
      limit: PAGE_SIZE,
    },
    { placeholderData: keepPreviousData },
  );

  const items = listQuery.data?.items ?? [];
  const total = listQuery.data?.total ?? 0;

  // 详情的翻单面：当前页切片里的前后单（行序即服务端排定的序）+ 页边界
  const nav = detailNav(items, selectedId, { page: query.page, pageSize: PAGE_SIZE, total });

  /** 选中单的路径：id 住 path，筛选参数随链接带走。 */
  function ticketPath(ticketId: string) {
    return `/external-tickets/${ticketId}${location.search}`;
  }

  /** 列表进详情 push（Back 回到列表），详情内翻单 replace（翻单是扫描动作）。 */
  function select(ticketId: string) {
    navigate(ticketPath(ticketId), { replace: selectedId !== undefined });
  }

  const crossPage = useCrossPageNav({
    items,
    page: query.page,
    isPlaceholderData: listQuery.isPlaceholderData,
    select,
    setPage: (page) => setParam("page", String(page), { resetPage: false }),
  });

  if (selectedId !== undefined) {
    return (
      <div className="flex min-h-0 flex-1 flex-col rounded-md border">
        <ExternalTicketDetailPane
          ticketId={selectedId}
          nav={nav}
          onSwitch={select}
          onCrossPage={crossPage}
          onClose={() => navigate(`/external-tickets${location.search}`)}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">我的工单</h1>
          <p className="text-sm text-muted-foreground">客服有新发言的工单排在最前。</p>
        </div>
        <Button onClick={() => setSubmitOpen(true)}>新建工单</Button>
      </div>

      <TicketListFilterBar>
        <MultiSelectFilter
          label="状态"
          values={query.status}
          options={TICKET_STATUSES.map((status) => ({
            value: status,
            label: TICKET_STATUS_LABELS[status],
          }))}
          onChange={(values) => setParam("status", values.length > 0 ? values.join(",") : null)}
        />
        <CreatedRangeFilter
          range={{ createdFrom: query.createdFrom, createdTo: query.createdTo }}
          onChange={(range) =>
            setParams({
              createdFrom: range.createdFrom ?? null,
              createdTo: range.createdTo ?? null,
            })
          }
        />
        <TicketListSearch
          draft={searchDraft}
          onDraftChange={setSearchDraft}
          onSubmit={submitSearch}
          placeholder="工单号 / 保单号 / 工单原文"
        />
        <div className="flex items-center gap-2">
          <Checkbox
            id="include-completed"
            checked={query.includeCompleted}
            onCheckedChange={(checked) => setParam("completed", checked === true ? "1" : null)}
          />
          <Label htmlFor="include-completed" className="text-sm font-normal">
            含已完结
          </Label>
        </div>
        <TicketExportButton onExport={(format) => downloadExternalTicketExport(query, format)} />
      </TicketListFilterBar>

      {listQuery.error ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>工单列表加载失败</AlertTitle>
          <AlertDescription>{listQuery.error.message}</AlertDescription>
        </Alert>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded-md border">
          <Table>
            {/* 表头随行滚动会丢失列语义，钉在滚动容器顶部 */}
            <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-background">
              <TableRow>
                <TableHead>工单号</TableHead>
                <TableHead>{TICKET_FIELDS.feedbackTime.label}</TableHead>
                <TableHead>{TICKET_FIELDS.policyNumbers.label}</TableHead>
                <TableHead>{TICKET_FIELDS.customerName.label}</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>客服最近跟进记录</TableHead>
                <TableHead>{TICKET_FIELDS.completionStatusId.label}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {listQuery.isLoading ? (
                <ListSkeletonRows columnCount={COLUMN_COUNT} />
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={COLUMN_COUNT} className="p-0">
                    <Empty className="border-0">
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <Inbox />
                        </EmptyMedia>
                        <EmptyTitle>没有工单</EmptyTitle>
                        <EmptyDescription>
                          {query.status.length > 0 ||
                          query.search ||
                          query.includeCompleted ||
                          query.createdFrom ||
                          query.createdTo ? (
                            "当前筛选条件下没有工单，换个条件试试。"
                          ) : (
                            <>点右上角「新建工单」，把客户反馈原文交给客服团队。</>
                          )}
                        </EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  </TableCell>
                </TableRow>
              ) : (
                items.map((ticket) => (
                  <TableRow
                    key={ticket.id}
                    className="cursor-pointer"
                    // 筛选串随车带走，返回列表时上下文不丢
                    onClick={() => navigate(ticketPath(ticket.id))}
                  >
                    <TableCell>
                      <span className="flex items-center gap-1.5">
                        <Link
                          to={ticketPath(ticket.id)}
                          className="font-medium hover:underline"
                          onClick={(event) => event.stopPropagation()}
                        >
                          {ticket.workOrderNumber}
                        </Link>
                        {/* 最新一条可见记录是客服发言 = 球在你这边 */}
                        {ticket.latestLog?.action === "comment" && <Badge>客服新发言</Badge>}
                      </span>
                    </TableCell>
                    <TableCell>
                      {ticket.feedbackTime ? formatDateTime(ticket.feedbackTime) : <Unknown />}
                    </TableCell>
                    <TableCell>
                      <PolicyNumbersCell policyNumbers={ticket.policyNumbers} />
                    </TableCell>
                    <TableCell>{ticket.customerName ?? <Unknown />}</TableCell>
                    <TableCell>
                      <StatusBadge status={ticket.status} />
                    </TableCell>
                    <TableCell>
                      {/* 无人跟进（create 日志 remark 为空）时留空，不占 — 占位 */}
                      {ticket.latestLog?.remark ? (
                        <span className="block max-w-72 truncate" title={ticket.latestLog.remark}>
                          {ticket.latestLog.remark}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {ticket.completionStatusName ?? (
                        <span className="text-muted-foreground">未完结</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {!listQuery.error && (
        <TicketListPagination
          total={total}
          page={query.page}
          pageSize={PAGE_SIZE}
          isLoading={listQuery.isLoading}
          onPageChange={(page) => setParam("page", String(page), { resetPage: false })}
        />
      )}

      <ExternalTicketSubmitDialog
        open={submitOpen}
        onOpenChange={setSubmitOpen}
        onSubmitted={(ticket) => {
          setSubmitOpen(false);
          navigate(ticketPath(ticket.id));
        }}
      />
    </div>
  );
}
