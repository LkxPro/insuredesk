import { PROCESS_LOG_ACTION_LABELS, type ProcessLogAction } from "@insuredesk/shared";
import { ArrowUp, ChevronDown, CircleCheck } from "lucide-react";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { formatDateTime } from "@/lib/datetime";
import { cn } from "@/lib/utils";

/**
 * 分栏详情的右栏：ProcessLog 聊天式时间线（可滚动）+ 钉在底部的 composer。
 * 内部（添加跟进）与外部（添加留言）共用本栏：log 形状已归一（外部把
 * createdAt 映射成 at 传入），composer 由调用方按门控决定给不给。
 *
 * 渲染规则：
 * - 倒序：最新条目在最上（API 给正序，本栏渲染前反转）
 * - 沟通条目（external_note/comment）是气泡：颜色区分类型（蓝=留言，琥珀=
 *   跟进），左右区分谁发的——incomingActions 落左侧带头像，让"对方在工单上
 *   有更新"一眼可见。内部默认客户留言是对方；外部端传 ["comment"]（客服跟进
 *   是对方）
 * - 完结是 emerald 细线里程碑：一行装齐 状态值·人·时间，备注裸文跟随。完结
 *   状态取工单当前目录名（resolve 一生一次，与工单恒 1:1）；目录改名会回映
 *   到历史留痕的显示，与详情左栏口径一致
 * - 编辑行点开看逐字段 旧值→新值；其余系统动作（创建/分配/上传）收成居中分隔细线
 * - status_change 不渲染：流转已由完结里程碑与沟通气泡讲完，独立一行是噪音
 *
 * 布局契约：本栏自身撑满详情区高度，只有时间线那一段滚动，composer 始终在
 * 视口内。时间线倒序，默认视口即顶部（最新即所见，换单也回到顶部）；新增
 * 条目时用户若翻下去看旧记录则不拽回，改弹「↑ 新记录」跳转钮。
 */

/** 时间线条目的归一形状：内外两端的 ProcessLog wire shape 都能映射进来。 */
export type TimelineLog = {
  id: string;
  action: ProcessLogAction;
  operatorName: string | null;
  at: string;
  remark: string | null;
};

type CommunicationAction = Extract<ProcessLogAction, "external_note" | "comment">;

function isCommunication(action: ProcessLogAction): action is CommunicationAction {
  return action === "external_note" || action === "comment";
}

/** 类型色只表达留言/跟进分类；"谁发的"由气泡左右位置表达，不在颜色里。 */
const COMM_TINT: Record<CommunicationAction, { badge: string; box: string }> = {
  external_note: {
    badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-300",
    box: "bg-blue-50 dark:bg-blue-950/40",
  },
  comment: {
    badge: "bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300",
    box: "bg-amber-50 dark:bg-amber-950/40",
  },
};

type EditDiffSegment = { label: string; from: string | null; to: string | null; raw: string };

/**
 * edit 留痕 remark 是审计串（"字段: 旧值→新值；…"），不是结构化数据——值里
 * 若含 "→"/"；" 会切错。按首个 ": " 与首个 "→" 解析，解析失败的段整段原文兜底。
 */
function parseEditRemark(remark: string): EditDiffSegment[] {
  return remark
    .split("；")
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      const colonIndex = segment.indexOf(": ");
      if (colonIndex === -1) {
        return { label: "", from: null, to: null, raw: segment };
      }
      const label = segment.slice(0, colonIndex);
      const rest = segment.slice(colonIndex + 2);
      const arrowIndex = rest.indexOf("→");
      if (arrowIndex === -1) {
        return { label, from: null, to: null, raw: rest };
      }
      return {
        label,
        from: rest.slice(0, arrowIndex),
        to: rest.slice(arrowIndex + 1),
        raw: segment,
      };
    });
}

/**
 * 贴顶滚动（倒序）：首屏与换单（最旧一条 id 变化——它按单稳定，新增条目
 * 不动它）都滚到顶；新增条目时若本就在顶部附近则跟着滚到顶，用户翻下去
 * 看旧记录时不拽回，改弹跳转钮。
 */
function useStickToTop(logs: readonly TimelineLog[]) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearTopRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  const oldestLogId = logs[logs.length - 1]?.id ?? null;
  const entryCount = logs.length;

  // biome-ignore lint/correctness/useExhaustiveDependencies: oldestLogId 是换单信号，不在 effect 体内使用
  useLayoutEffect(() => {
    nearTopRef.current = true;
    setShowJump(false);
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = 0;
    }
  }, [oldestLogId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: entryCount 是新增条目的触发信号，不在 effect 体内使用
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    if (nearTopRef.current) {
      el.scrollTop = 0;
    } else {
      setShowJump(true);
    }
  }, [entryCount]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    nearTopRef.current = el.scrollTop < 80;
    if (nearTopRef.current) {
      setShowJump(false);
    }
  }

  function jumpToLatest() {
    scrollRef.current?.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  return { scrollRef, handleScroll, showJump, jumpToLatest };
}

export function TicketTimelineColumn({
  logs,
  composer,
  incomingActions = ["external_note"],
  completionStatus,
}: {
  logs: readonly TimelineLog[];
  /** 钉底的输入区；undefined = 本单不接受新记录（如已完结）。 */
  composer?: ReactNode;
  /** 从当前查看者视角"对方发出"的 action。 */
  incomingActions?: readonly ProcessLogAction[];
  completionStatus?: string | null;
}) {
  const visibleLogs = logs.filter((log) => log.action !== "status_change").reverse();
  const { scrollRef, handleScroll, showJump, jumpToLatest } = useStickToTop(visibleLogs);

  return (
    <div className="flex flex-col xl:min-h-0">
      <h3 className="m-0 shrink-0 border-b px-4 py-3 text-sm font-medium text-muted-foreground">
        处理记录
      </h3>

      <div className="relative xl:min-h-0 xl:flex-1">
        <div ref={scrollRef} onScroll={handleScroll} className="p-4 xl:h-full xl:overflow-y-auto">
          {visibleLogs.length === 0 ? (
            <p className="m-0 text-sm text-muted-foreground">还没有处理记录。</p>
          ) : (
            <ol className="m-0 flex list-none flex-col gap-3 p-0">
              {visibleLogs.map((log) => (
                <TimelineItem
                  key={log.id}
                  log={log}
                  incoming={incomingActions.includes(log.action)}
                  completionStatus={completionStatus}
                />
              ))}
            </ol>
          )}
        </div>
        {showJump && (
          <button
            type="button"
            onClick={jumpToLatest}
            className="absolute top-3 right-4 hidden items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-lg xl:flex"
          >
            <ArrowUp className="size-3.5" />
            新记录
          </button>
        )}
      </div>

      {composer && <div className="shrink-0 border-t p-4">{composer}</div>}
    </div>
  );
}

function TimelineItem({
  log,
  incoming,
  completionStatus,
}: {
  log: TimelineLog;
  incoming: boolean;
  completionStatus?: string | null;
}) {
  if (log.action === "resolve") {
    return <ResolveItem log={log} completionStatus={completionStatus} />;
  }
  if (log.action === "edit" && log.remark) {
    return <EditItem log={log} remark={log.remark} />;
  }
  if (isCommunication(log.action)) {
    return <CommunicationItem log={log} action={log.action} incoming={incoming} />;
  }
  return <SystemItem log={log} />;
}

function ResolveItem({
  log,
  completionStatus,
}: {
  log: TimelineLog;
  completionStatus?: string | null;
}) {
  return (
    <li className="flex flex-col gap-1 py-0.5">
      <div className="flex items-center gap-3">
        <span aria-hidden className="h-px flex-1 bg-border" />
        <span className="flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
          <CircleCheck className="size-3.5" />
          完结{completionStatus ? ` · ${completionStatus}` : ""}
          {log.operatorName ? ` · ${log.operatorName}` : ""} · {formatDateTime(log.at)}
        </span>
        <span aria-hidden className="h-px flex-1 bg-border" />
      </div>
      {log.remark && (
        <p className="m-0 whitespace-pre-wrap px-1 text-sm text-muted-foreground">{log.remark}</p>
      )}
    </li>
  );
}

function EditItem({ log, remark }: { log: TimelineLog; remark: string }) {
  const [expanded, setExpanded] = useState(false);
  const segments = parseEditRemark(remark);

  return (
    <li className="flex flex-col items-center gap-1.5 py-0.5">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        className="group flex w-full items-center gap-3"
      >
        <span aria-hidden className="h-px flex-1 bg-border" />
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground group-hover:text-foreground">
          编辑工单{log.operatorName ? ` · ${log.operatorName}` : ""} · {formatDateTime(log.at)}
          <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} />
        </span>
        <span aria-hidden className="h-px flex-1 bg-border" />
      </button>
      {expanded && (
        <div className="w-full max-w-[90%] rounded-lg border bg-card px-3 py-2">
          <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs">
            {segments.map((segment) => (
              <div key={segment.label || segment.raw} className="contents">
                <dt className="text-muted-foreground">{segment.label || "修改"}</dt>
                <dd className="m-0 min-w-0 break-all">
                  {segment.from !== null && segment.to !== null ? (
                    <>
                      <span className="text-muted-foreground line-through">{segment.from}</span>
                      <span className="mx-1 text-muted-foreground">→</span>
                      <span className="font-medium text-foreground">{segment.to}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">{segment.raw}</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </li>
  );
}

function CommunicationItem({
  log,
  action,
  incoming,
}: {
  log: TimelineLog;
  action: CommunicationAction;
  incoming: boolean;
}) {
  const tint = COMM_TINT[action];
  return (
    <li className={cn("flex items-end gap-2", !incoming && "justify-end")}>
      {incoming && (
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
            tint.badge,
          )}
        >
          {(log.operatorName ?? "对方").slice(0, 1)}
        </span>
      )}
      <div className={cn("max-w-[85%]", !incoming && "flex flex-col items-end")}>
        <div className="mb-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className={cn("rounded-sm px-1.5 py-0.5 font-semibold", tint.badge)}>
            {PROCESS_LOG_ACTION_LABELS[action]}
          </span>
          {log.operatorName && <span>{log.operatorName}</span>}
          <span>{formatDateTime(log.at)}</span>
        </div>
        <div
          className={cn(
            "whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm shadow-sm",
            incoming ? cn("rounded-bl-sm border", tint.box) : "rounded-br-sm bg-muted",
          )}
        >
          {log.remark ?? "（无留言内容）"}
        </div>
      </div>
    </li>
  );
}

function SystemItem({ log }: { log: TimelineLog }) {
  return (
    <li className="flex items-center gap-3 py-0.5">
      <span aria-hidden className="h-px flex-1 bg-border" />
      <span className="text-xs text-muted-foreground">
        {PROCESS_LOG_ACTION_LABELS[log.action]}
        {log.operatorName ? ` · ${log.operatorName}` : ""} · {formatDateTime(log.at)}
      </span>
      <span aria-hidden className="h-px flex-1 bg-border" />
    </li>
  );
}
