import type { ProcessLogAction } from "@insuredesk/shared";
import { AlertCircle, ArrowLeft, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { handleDetailArrowKey } from "@/pages/tickets/detail-navigation";
import { TicketTimelineColumn } from "@/pages/tickets/TicketTimelineColumn";
import { ExternalNoteCard } from "./ExternalNoteCard";
import { ExternalTicketInfoColumn } from "./ExternalTicketInfoColumn";

/**
 * 右栏详情，镜像内部分栏：头部（工单号+状态+常驻 X，窄屏另给返回键）→
 * 左栏工单信息（原文折叠+白名单字段），右栏处理记录时间线与钉底留言框。
 * 已完结是终态，只读（无留言框）。时间线内容已由服务端过滤（create +
 * comment 非 internal + external_note + resolve），这里只按 action 给圆点
 * 着色区分"谁发出的"。
 *
 * ↑/↓ 按列表顺序翻单（neighbors 由页面按当前筛选算出，列表边缘为 null 不
 * 动作）；输入控件内的方向键归控件自己。key={ticketId} 强制换单重挂：
 * 折叠态与留言草稿不跨单残留。
 */

/** 时间线圆点按 action 着色：外部留言是"我方发出"，与内部跟进一眼可分。 */
const DOT_CLASS_BY_ACTION: Partial<Record<ProcessLogAction, string>> = {
  external_note: "border-blue-500",
  resolve: "border-emerald-500",
};

function dotClassName(action: ProcessLogAction) {
  return DOT_CLASS_BY_ACTION[action] ?? "border-primary";
}

function itemClassName(action: ProcessLogAction) {
  if (action === "external_note") return "bg-amber-50 px-3 py-2 dark:bg-amber-950/30";
  if (action === "resolve") return "bg-emerald-50 px-3 py-2 dark:bg-emerald-950/30";
  return "";
}

export function ExternalTicketDetailPane({
  ticketId,
  onClose,
  onSwitch,
  /** ↑/↓ 的目标，列表边缘为 null（无动作）。 */
  neighbors,
}: {
  ticketId: string;
  onClose: () => void;
  onSwitch: (ticketId: string) => void;
  neighbors: { prev: string | null; next: string | null };
}) {
  const detailQuery = trpc.externalTicket.detail.useQuery({ ticketId });
  const utils = trpc.useUtils();
  const data = detailQuery.data;
  const paneRef = useRef<HTMLElement>(null);

  // ↑/↓ 翻单靠 keydown 冒泡到本区，焦点留在窄列按钮上时事件到不了这里
  // biome-ignore lint/correctness/useExhaustiveDependencies: ticketId 是触发聚焦的信号，不在 effect 体内使用
  useEffect(() => {
    paneRef.current?.focus({ preventScroll: true });
  }, [ticketId]);

  useEffect(() => {
    if (data) void utils.externalTicket.list.invalidate();
  }, [data, utils.externalTicket.list]);

  return (
    <section
      ref={paneRef}
      aria-label="工单详情"
      className="flex min-h-0 flex-1 flex-col outline-hidden"
      tabIndex={-1}
      onKeyDown={(event) => handleDetailArrowKey(event, neighbors, onSwitch)}
    >
      <div className="flex shrink-0 items-center gap-2 border-b px-4 py-3">
        {/* 窄屏主从不并存，返回键让位列表；宽屏它纯属多余 */}
        <Button
          variant="ghost"
          size="icon"
          className="size-7 lg:hidden"
          aria-label="返回列表"
          onClick={onClose}
        >
          <ArrowLeft />
        </Button>
        <h2 className="m-0 text-lg font-semibold tracking-tight">工单详情</h2>
        <div className="flex-1" />
        <Button variant="ghost" size="icon" aria-label="关闭详情" onClick={onClose}>
          <X />
        </Button>
      </div>

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
            <ExternalTicketInfoColumn ticket={data.ticket} visibleFields={data.visibleFields} />
          </div>
          <TicketTimelineColumn
            logs={data.processLogs.map((log, index) => ({
              id: `${log.createdAt}-${log.action}-${index}`,
              action: log.action,
              operatorName: log.operatorName,
              at: log.createdAt,
              remark: log.remark,
            }))}
            dotClassName={dotClassName}
            itemClassName={itemClassName}
            composer={data.canAddNote ? <ExternalNoteCard ticketId={ticketId} /> : undefined}
          />
        </div>
      )}
    </section>
  );
}
