import {
  externalTicketListInputSchema,
  TICKET_STATUS_LABELS,
  TICKET_STATUSES,
  type TicketStatus,
} from "@insuredesk/shared";
import { keepPreviousData } from "@tanstack/react-query";
import { AlertCircle, Inbox } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { CreatedRangeFilter } from "@/components/ticket-list/CreatedRangeFilter";
import { MultiSelectFilter } from "@/components/ticket-list/MultiSelectFilter";
import { TicketExportButton } from "@/components/ticket-list/TicketExportButton";
import { TicketListFilterBar } from "@/components/ticket-list/TicketListFilterBar";
import { TicketListPagination } from "@/components/ticket-list/TicketListPagination";
import { TicketListSearch } from "@/components/ticket-list/TicketListSearch";
import { useTicketListUrl } from "@/components/ticket-list/useTicketListUrl";
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
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { detailNav, useCrossPageNav } from "@/pages/tickets/detail-navigation";
import { ExternalTicketDetailPane } from "./ExternalTicketDetailPane";
import { ExternalTicketListPane } from "./ExternalTicketListPane";
import { ExternalTicketSubmitDialog } from "./ExternalTicketSubmitDialog";
import { downloadExternalTicketExport } from "./external-ticket-export";

/**
 * 外部端主页：左列表右详情的主从单页（/external-tickets 与
 * /external-tickets/:id 都渲染本页，:id 即选中）。跟进为主的外部方进来
 * 第一眼是该说话的单（服务端把客服新发言的工单排在最前），点行右栏即换，
 * 永不跳页；新建是顶部按钮唤起对话框，提交成功自动选中新单。
 *
 * 窄屏（<lg）主从不并存：列表占满，点行进详情，详情头部给返回键。
 * 筛选（状态/关键词/含已完结）与分页住在 URL query 里，选中住在 path 里，
 * 深链与刷新都不丢上下文。
 */

const PAGE_SIZE = 20;

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
  const { hasPermission } = useAuth();
  const canExport = hasPermission("ticket.export_external");
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

  // 着陆默认选中第一单（列表顶部 = 最该看的）；replace 不让 Back
  // 重放这一步。窄屏不自动选——用户的第一眼是列表本身，点谁看谁。
  useEffect(() => {
    const first = items[0];
    if (selectedId !== undefined || !first || !isMasterDetailViewport()) {
      return;
    }
    navigate(`/external-tickets/${first.id}${location.search}`, { replace: true });
  }, [selectedId, items, location.search, navigate]);

  /** 首次选中 push（Back 回到无选中），已选中后换单 replace（翻单是扫描动作）。 */
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
        {canExport && (
          <TicketExportButton onExport={(format) => downloadExternalTicketExport(query, format)} />
        )}
      </TicketListFilterBar>

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
            ) : (
              <ExternalTicketListPane
                items={items}
                isLoading={listQuery.isLoading}
                selectedId={selectedId}
                onSelect={select}
              />
            )}
          </div>

          {selectedId !== undefined && (
            <div className="flex min-h-0 flex-col rounded-md border">
              <ExternalTicketDetailPane
                ticketId={selectedId}
                nav={nav}
                onSwitch={select}
                onCrossPage={crossPage}
                onClose={() => navigate(`/external-tickets${location.search}`)}
              />
            </div>
          )}
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
