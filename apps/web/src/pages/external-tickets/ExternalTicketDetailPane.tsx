import type { ProcessLogAction } from "@insuredesk/shared";
import { AlertCircle, ArrowLeft } from "lucide-react";
import { useEffect, useRef } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { DetailNavButtons } from "@/pages/tickets/DetailNavButtons";
import {
  type CrossPageDirection,
  type DetailNav,
  type DetailNavStep,
  detailNavStep,
  handleDetailArrowKey,
} from "@/pages/tickets/detail-navigation";
import { StatusBadge } from "@/pages/tickets/StatusBadge";
import { TicketTimelineColumn } from "@/pages/tickets/TicketTimelineColumn";
import { ExternalNoteCard } from "./ExternalNoteCard";
import { ExternalTicketInfoColumn } from "./ExternalTicketInfoColumn";

/**
 * 整页详情，镜像内部分栏：头部（返回列表+工单号+状态+翻单按钮）→ 左栏工单
 * 信息（原文折叠+白名单字段），右栏处理记录时间线与钉底留言框。已完结是终态，
 * 只读（无留言框）。时间线内容已由服务端过滤（create + comment 非 internal +
 * external_note + resolve），这里只按 action 给圆点着色区分"谁发出的"。
 *
 * 方向键（↑/↓/←/→）与 prev/next 按钮按列表顺序翻单，越界翻页（nav 由页面
 * 按当前筛选与页码算出，无路可走则按钮禁用、按键死停）；输入控件内的方向
 * 键归控件自己。key={ticketId} 强制换单重挂：折叠态与留言草稿不跨单残留。
 */

/** 时间线圆点按 action 着色：外部留言是"我方发出"，与内部跟进一眼可分。 */
const DOT_CLASS_BY_ACTION: Partial<Record<ProcessLogAction, string>> = {
  external_note: "border-blue-500",
  resolve: "border-emerald-500",
};

function dotClassName(action: ProcessLogAction) {
  return DOT_CLASS_BY_ACTION[action] ?? "border-primary";
}

export function ExternalTicketDetailPane({
  ticketId,
  onClose,
  onSwitch,
  onCrossPage,
  /** 方向键与 prev/next 按钮共用的导航面。 */
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
  const paneRef = useRef<HTMLElement>(null);

  // ↑/↓ 翻单靠 keydown 冒泡到本区，焦点留在窄列按钮上时事件到不了这里
  // biome-ignore lint/correctness/useExhaustiveDependencies: ticketId 是触发聚焦的信号，不在 effect 体内使用
  useEffect(() => {
    paneRef.current?.focus({ preventScroll: true });
  }, [ticketId]);

  /** 键盘与 prev/next 按钮同一入口。 */
  function applyStep(step: DetailNavStep) {
    if (step.kind === "switch") {
      onSwitch(step.ticketId);
    } else {
      onCrossPage(step.direction);
    }
  }

  const prevStep = detailNavStep("prev", nav);
  const nextStep = detailNavStep("next", nav);

  return (
    <section
      ref={paneRef}
      aria-label="工单详情"
      className="flex min-h-0 flex-1 flex-col outline-hidden"
      tabIndex={-1}
      onKeyDown={(event) => handleDetailArrowKey(event, nav, applyStep)}
    >
      <div className="flex shrink-0 items-center gap-2 border-b px-4 py-3">
        <Button variant="ghost" size="icon" aria-label="返回列表" onClick={onClose}>
          <ArrowLeft />
        </Button>
        <h2 className="m-0 text-lg font-semibold tracking-tight">
          {ticket?.workOrderNumber ?? "工单详情"}
        </h2>
        {ticket && <StatusBadge status={ticket.status} />}
        <div className="flex-1" />
        <DetailNavButtons prevStep={prevStep} nextStep={nextStep} onStep={applyStep} />
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
            dotClassName={dotClassName}
            composer={
              data.ticket.status !== "completed" ? (
                <ExternalNoteCard ticketId={ticketId} />
              ) : undefined
            }
          />
        </div>
      )}
    </section>
  );
}
