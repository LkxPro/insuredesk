import { PROCESS_LOG_ACTION_LABELS } from "@insuredesk/shared";
import { formatDateTime } from "@/lib/datetime";
import { AddCommentCard } from "./AddCommentCard";
import type { TicketDetail } from "./ticket-detail";

/**
 * 分栏详情的右栏：ProcessLog 时间线（可滚动）+ 钉在底部的添加跟进输入框。
 *
 * 布局契约：本栏自身撑满详情区高度，只有时间线那一段滚动，跟进输入框始终在
 * 视口内 —— 客服写跟进时不需要先滚到底。跟进入口的门控（ticket.process + 在
 * 途状态）由调用方决定，本组件只按 `canComment` 渲染。
 */
export function TicketTimelineColumn({
  ticket,
  canComment,
}: {
  ticket: TicketDetail;
  canComment: boolean;
}) {
  return (
    <div className="flex min-h-0 flex-col">
      <h3 className="m-0 shrink-0 border-b px-4 py-3 text-sm font-medium text-muted-foreground">
        处理记录
      </h3>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {ticket.processLogs.length === 0 ? (
          <p className="m-0 text-sm text-muted-foreground">还没有处理记录。</p>
        ) : (
          <ol className="m-0 flex list-none flex-col p-0">
            {ticket.processLogs.map((log, index) => (
              <li key={log.id} className="relative flex gap-3 pb-5 last:pb-0">
                {index < ticket.processLogs.length - 1 && (
                  <span aria-hidden className="absolute left-[5px] top-4 h-full w-px bg-border" />
                )}
                <span className="mt-1.5 size-[11px] shrink-0 rounded-full border-2 border-primary bg-background" />
                <div className="flex min-w-0 flex-col gap-0.5">
                  <div className="flex flex-wrap items-center gap-x-2 text-sm">
                    <span className="font-medium">{PROCESS_LOG_ACTION_LABELS[log.action]}</span>
                    {log.operatorName && (
                      <span className="text-muted-foreground">{log.operatorName}</span>
                    )}
                    <span className="text-xs text-muted-foreground">{formatDateTime(log.at)}</span>
                  </div>
                  {log.remark && (
                    <p className="m-0 whitespace-pre-wrap text-sm text-muted-foreground">
                      {log.remark}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>

      {canComment && (
        <div className="shrink-0 border-t p-4">
          <AddCommentCard ticketId={ticket.id} />
        </div>
      )}
    </div>
  );
}
