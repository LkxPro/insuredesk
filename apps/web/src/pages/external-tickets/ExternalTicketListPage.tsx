import { TICKET_STATUS_LABELS, TICKET_STATUSES, type TicketStatus } from "@insuredesk/shared";
import { keepPreviousData } from "@tanstack/react-query";
import { AlertCircle, Inbox, Plus, Search } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { MultiSelectFilter } from "@/pages/tickets/MultiSelectFilter";
import { ExternalTicketSubmitDialog } from "./ExternalTicketSubmitDialog";
import { externalFieldLabel, externalFieldValue } from "./external-ticket-fields";

/**
 * 我的工单：外部账号的首屏。列按当前账号所属机构的可见字段白名单动态渲染
 * （白名单随列表响应下发——外部方读不到机构配置接口），顺序即白名单顺序，
 * 管理员改配置后无需改代码。数据范围（本机构 + 未删除）与字段裁剪都在服务端，
 * 这里渲染拿到的一切。
 *
 * 筛选与分页状态住在 URL 里，与 工单管理 同一套 deep-link 处理；排序固定
 * createdAt DESC，外部方只关心最新提交在最前。
 */

const PAGE_SIZE = 20;

/** URL → 查询参数；单个参数畸形只退回它自己的缺省，不连坐其他筛选。 */
function parseQuery(params: URLSearchParams) {
  const rawStatus = params.get("status")?.split(",").filter(Boolean) ?? [];
  const status = rawStatus.filter((value): value is TicketStatus =>
    TICKET_STATUSES.includes(value as TicketStatus),
  );
  const page = Math.max(1, Number(params.get("page")) || 1);
  return { status, search: params.get("q") ?? "", page };
}

export function ExternalTicketListPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const query = parseQuery(searchParams);
  const [searchDraft, setSearchDraft] = useState(query.search);
  const [submitOpen, setSubmitOpen] = useState(false);

  const listQuery = trpc.externalTicket.list.useQuery(
    {
      status: query.status.length > 0 ? query.status : undefined,
      search: query.search || undefined,
      offset: (query.page - 1) * PAGE_SIZE,
      limit: PAGE_SIZE,
    },
    { placeholderData: keepPreviousData },
  );

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

  const items = listQuery.data?.items ?? [];
  const total = listQuery.data?.total ?? 0;
  const columns = listQuery.data?.visibleFields ?? [];
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">我的工单</h1>
          <p className="text-sm text-muted-foreground">
            本机构提交的工单，状态与对外公开的跟进记录实时可见。
          </p>
        </div>
        <Button onClick={() => setSubmitOpen(true)}>
          <Plus data-icon="inline-start" />
          提交工单
        </Button>
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
            placeholder="工单号 / 工单原文"
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
        <div className="min-h-0 flex-1 overflow-auto rounded-md border">
          <Table>
            {/* 表头随行滚动会丢失列语义，钉在滚动容器顶部 */}
            <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-background">
              <TableRow>
                {columns.map((key) => (
                  <TableHead key={key}>{externalFieldLabel(key, "listLabel")}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {listQuery.isLoading ? (
                [0, 1, 2, 3, 4].map((row) => (
                  <TableRow key={row}>
                    {(columns.length > 0 ? columns : ["a", "b", "c"]).map((key) => (
                      <TableCell key={key}>
                        <Skeleton className="h-4 w-full max-w-24" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={Math.max(1, columns.length)} className="h-64">
                    <Empty className="border-0">
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <Inbox />
                        </EmptyMedia>
                        <EmptyTitle>没有工单</EmptyTitle>
                        <EmptyDescription>
                          {query.status.length > 0 || query.search
                            ? "当前筛选条件下没有工单，换个条件试试。"
                            : "点击「提交工单」把客户反馈原文交给客服团队。"}
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
                    onClick={() => navigate(`/external-tickets/${ticket.id}`)}
                  >
                    {columns.map((key) => (
                      <TableCell key={key} className="max-w-72 truncate">
                        {key === "workOrderNumber" ? (
                          // 行点击是鼠标的便利路径；工单号上的链接是键盘与
                          // 读屏的正路（与 工单管理 同一处理）
                          <Link
                            to={`/external-tickets/${ticket.id}`}
                            className="font-medium hover:underline"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {ticket.workOrderNumber}
                          </Link>
                        ) : (
                          (externalFieldValue(ticket, key) ?? (
                            <span className="text-muted-foreground">—</span>
                          ))
                        )}
                      </TableCell>
                    ))}
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

      <ExternalTicketSubmitDialog open={submitOpen} onOpenChange={setSubmitOpen} />
    </div>
  );
}
