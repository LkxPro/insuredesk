import { AlertCircle, ArrowLeft } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { DetailPaneShell } from "@/pages/ticket-surface/DetailPaneShell";
import type {
  CrossPageDirection,
  DetailNav,
  DetailNavStep,
} from "@/pages/ticket-surface/detail-navigation";
import { StatusBadge } from "@/pages/ticket-surface/StatusBadge";
import { TicketTimelineColumn } from "@/pages/ticket-surface/TicketTimelineColumn";
import { ExternalNoteCard } from "./ExternalNoteCard";
import { ExternalTicketInfoColumn } from "./ExternalTicketInfoColumn";

/**
 * 时间线内容已由服务端过滤（create + comment 非 internal + external_note +
 * resolve）；从外部方视角客服跟进（comment）是"对方发出"，落左侧气泡。
 * key={ticketId} 强制换单重挂：折叠态与留言草稿不跨单残留。
 */

export function ExternalTicketDetailPane({
  ticketId,
  onClose,
  onSwitch,
  onCrossPage,
  nav,
}: {
  ticketId: string;
  onClose: () => void;
  onSwitch: (ticketId: string) => void;
  onCrossPage: (direction: CrossPageDirection) => void;
  nav: DetailNav;
}) {
  const detailQuery = trpc.externalTicket.detail.useQuery({ ticketId });
  const data = detailQuery.data;
  const ticket = data?.ticket ?? null;

  function applyStep(step: DetailNavStep) {
    if (step.kind === "switch") {
      onSwitch(step.ticketId);
    } else {
      onCrossPage(step.direction);
    }
  }

  return (
    <DetailPaneShell
      focusKey={ticketId}
      nav={nav}
      onStep={applyStep}
      leading={
        <Button variant="ghost" size="icon" aria-label="返回列表" onClick={onClose}>
          <ArrowLeft />
        </Button>
      }
      title={ticket?.workOrderNumber}
      status={ticket && <StatusBadge status={ticket.status} />}
    >
      {detailQuery.error ? (
        <Alert variant="destructive" className="m-4">
          <AlertCircle />
          <AlertTitle>工单加载失败</AlertTitle>
          <AlertDescription>{detailQuery.error.message}</AlertDescription>
        </Alert>
      ) : !data ? (
        <div className="flex flex-col gap-4 p-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <div
          key={ticketId}
          className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]"
        >
          <div className="overflow-y-auto p-4 xl:min-h-0 xl:border-r">
            <ExternalTicketInfoColumn ticket={data.ticket} />
          </div>
          <TicketTimelineColumn
            logs={data.processLogs.map((log) => ({
              id: log.id,
              action: log.action,
              operatorName: log.operatorName,
              at: log.createdAt,
              remark: log.remark,
            }))}
            incomingActions={["comment"]}
            completionStatus={data.ticket.completionStatusName}
            composer={
              data.ticket.status !== "completed" ? (
                <ExternalNoteCard ticketId={ticketId} />
              ) : undefined
            }
          />
        </div>
      )}
    </DetailPaneShell>
  );
}
