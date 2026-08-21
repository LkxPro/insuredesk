import type { AppRouter } from "@insuredesk/api";
import {
  externalTicketListInputSchema,
  TICKET_FIELDS,
  TICKET_STATUS_LABELS,
  TICKET_STATUSES,
  type TicketStatus,
} from "@insuredesk/shared";
import { keepPreviousData } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { Inbox } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/datetime";
import { trpc } from "@/lib/trpc";
import { CreatedRangeFilter } from "@/pages/ticket-surface/CreatedRangeFilter";
import { MultiSelectFilter } from "@/pages/ticket-surface/MultiSelectFilter";
import { PolicyNumbersCell } from "@/pages/ticket-surface/PolicyNumbersCell";
import { StatusBadge } from "@/pages/ticket-surface/StatusBadge";
import { TicketExportButton } from "@/pages/ticket-surface/TicketExportButton";
import { TicketListSearch } from "@/pages/ticket-surface/TicketListSearch";
import { type SurfaceColumn, TicketSurface } from "@/pages/ticket-surface/TicketSurface";
import { Unknown } from "@/pages/ticket-surface/Unknown";
import { ExternalTicketDetailPane } from "./ExternalTicketDetailPane";
import { ExternalTicketSubmitDialog } from "./ExternalTicketSubmitDialog";
import { downloadExternalTicketExport } from "./external-ticket-export";

type ListItem = inferRouterOutputs<AppRouter>["externalTicket"]["list"]["items"][number];

type ExternalListQuery = {
  status: TicketStatus[];
  search: string;
  createdFrom?: string | undefined;
  createdTo?: string | undefined;
  page: number;
  pageSize: number;
};

const PAGE_SIZE = 20;

function parseQuery(params: URLSearchParams): ExternalListQuery {
  const rawStatus = params.get("status")?.split(",").filter(Boolean) ?? [];
  const status = rawStatus.filter((value): value is TicketStatus =>
    TICKET_STATUSES.includes(value as TicketStatus),
  );
  return {
    status,
    search: params.get("q") ?? "",
    createdFrom: salvageDateTime(params.get("createdFrom")),
    createdTo: salvageDateTime(params.get("createdTo")),
    page: Math.max(1, Number(params.get("page")) || 1),
    pageSize: PAGE_SIZE,
  };
}

function salvageDateTime(raw: string | null) {
  return raw !== null && externalTicketListInputSchema.shape.createdFrom.safeParse(raw).success
    ? raw
    : undefined;
}

function useExternalTicketList(query: ExternalListQuery) {
  const listQuery = trpc.externalTicket.list.useQuery(
    {
      status: query.status.length > 0 ? query.status : undefined,
      search: query.search || undefined,
      createdFrom: query.createdFrom,
      createdTo: query.createdTo,
      offset: (query.page - 1) * query.pageSize,
      limit: query.pageSize,
    },
    { placeholderData: keepPreviousData },
  );
  return {
    items: listQuery.data?.items ?? [],
    total: listQuery.data?.total ?? 0,
    isLoading: listQuery.isLoading,
    isPlaceholderData: listQuery.isPlaceholderData,
    error: listQuery.error,
  };
}

const columns: ReadonlyArray<SurfaceColumn<ListItem, ExternalListQuery>> = [
  {
    key: "workOrderNumber",
    header: "工单号",
    render: (ticket, ctx) => (
      <span className="flex items-center gap-1.5">
        <Link
          to={ctx.ticketPath(ticket.id)}
          className="font-medium hover:underline"
          onClick={(event) => event.stopPropagation()}
        >
          {ticket.workOrderNumber}
        </Link>
        {/* 最新一条可见记录是客服发言 = 球在你这边 */}
        {ticket.latestLog?.action === "comment" && <Badge>客服新发言</Badge>}
      </span>
    ),
  },
  {
    key: "feedbackTime",
    header: TICKET_FIELDS.feedbackTime.label,
    render: (ticket) => (ticket.feedbackTime ? formatDateTime(ticket.feedbackTime) : <Unknown />),
  },
  {
    key: "policyNumbers",
    header: TICKET_FIELDS.policyNumbers.label,
    render: (ticket) => <PolicyNumbersCell policyNumbers={ticket.policyNumbers} />,
  },
  {
    key: "customerName",
    header: TICKET_FIELDS.customerName.label,
    render: (ticket) => ticket.customerName ?? <Unknown />,
  },
  {
    key: "status",
    header: "状态",
    render: (ticket) => <StatusBadge status={ticket.status} />,
  },
  {
    key: "latestLog",
    header: "客服最近跟进记录",
    render: (ticket) =>
      ticket.latestLog?.remark ? (
        <span className="block max-w-72 truncate" title={ticket.latestLog.remark}>
          {ticket.latestLog.remark}
        </span>
      ) : null,
  },
  {
    key: "completionStatus",
    header: TICKET_FIELDS.completionStatusId.label,
    render: (ticket) =>
      ticket.completionStatusName ?? <span className="text-muted-foreground">未完结</span>,
  },
];

export function ExternalTicketsPage() {
  const [submitOpen, setSubmitOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <TicketSurface
      basePath="/external-tickets"
      parseQuery={parseQuery}
      useList={useExternalTicketList}
      title="我的工单"
      subtitle="客服有新发言的工单排在最前。"
      headerActions={({ query }) => (
        <>
          <TicketExportButton onExport={(format) => downloadExternalTicketExport(query, format)} />
          <Button onClick={() => setSubmitOpen(true)}>新建工单</Button>
        </>
      )}
      filters={({
        query,
        searchDraft,
        setSearchDraft,
        submitSearch,
        clearSearch,
        setParam,
        setParams,
      }) => (
        <>
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
            onClear={clearSearch}
            placeholder="工单号 / 保单号 / 工单原文"
          />
        </>
      )}
      activeFilterCount={(query) =>
        [
          query.status.length,
          query.search ? 1 : 0,
          query.createdFrom || query.createdTo ? 1 : 0,
        ].filter((count) => count > 0).length
      }
      columns={columns}
      emptyState={{
        icon: <Inbox />,
        title: "没有工单",
        description: (query) =>
          query.status.length > 0 || query.search || query.createdFrom || query.createdTo ? (
            "当前筛选条件下没有工单，换个条件试试。"
          ) : (
            <>点右上角「新建工单」，把客户反馈原文交给客服团队。</>
          ),
      }}
      narrowItem={(ticket) => ({
        id: ticket.id,
        customerName: ticket.customerName,
        status: ticket.status,
        time: ticket.feedbackTime,
      })}
      renderDetail={(props) => <ExternalTicketDetailPane {...props} />}
      dialogs={({ ticketPath }) => (
        <ExternalTicketSubmitDialog
          open={submitOpen}
          onOpenChange={setSubmitOpen}
          onSubmitted={(ticket) => {
            setSubmitOpen(false);
            navigate(ticketPath(ticket.id));
          }}
        />
      )}
      listGapClassName="gap-4"
    />
  );
}
