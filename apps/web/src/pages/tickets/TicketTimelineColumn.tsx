import { PROCESS_LOG_ACTION_LABELS, type ProcessLogAction } from "@insuredesk/shared";
import type { ReactNode } from "react";
import { formatDateTime } from "@/lib/datetime";
import { cn } from "@/lib/utils";

/**
 * 分栏详情的右栏：ProcessLog 时间线（可滚动）+ 钉在底部的 composer。
 * 内部（添加跟进）与外部（添加留言）共用本栏：log 形状已归一（外部把
 * createdAt 映射成 at 传入），composer 由调用方按门控决定给不给，圆点
 * 着色默认全 primary，外部传映射按 action 区分"谁发出的"。
 *
 * 布局契约：本栏自身撑满详情区高度，只有时间线那一段滚动，composer 始终在
 * 视口内 —— 写跟进/留言时不需要先滚到底。
 */

/** 时间线条目的归一形状：内外两端的 ProcessLog wire shape 都能映射进来。 */
export type TimelineLog = {
  id: string;
  action: ProcessLogAction;
  operatorName: string | null;
  at: string;
  remark: string | null;
};

export function TicketTimelineColumn({
  logs,
  composer,
  dotClassName = () => "border-primary",
}: {
  logs: readonly TimelineLog[];
  /** 钉底的输入区；undefined = 本单不接受新记录（如已完结）。 */
  composer?: ReactNode;
  /** 圆点按 action 着色；默认全 primary（内部不区分发出方）。 */
  dotClassName?: (action: ProcessLogAction) => string;
}) {
  return (
    <div className="flex flex-col xl:min-h-0">
      <h3 className="m-0 shrink-0 border-b px-4 py-3 text-sm font-medium text-muted-foreground">
        处理记录
      </h3>

      <div className="p-4 xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
        {logs.length === 0 ? (
          <p className="m-0 text-sm text-muted-foreground">还没有处理记录。</p>
        ) : (
          <ol className="m-0 flex list-none flex-col p-0">
            {logs.map((log, index) => (
              <li key={log.id} className="relative flex gap-3 pb-5 last:pb-0">
                {index < logs.length - 1 && (
                  <span aria-hidden className="absolute left-[5px] top-4 h-full w-px bg-border" />
                )}
                <span
                  className={cn(
                    "mt-1.5 size-[11px] shrink-0 rounded-full border-2 bg-background",
                    dotClassName(log.action),
                  )}
                />
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

      {composer && <div className="shrink-0 border-t p-4">{composer}</div>}
    </div>
  );
}
