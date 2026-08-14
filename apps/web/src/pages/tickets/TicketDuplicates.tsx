import type { AppRouter } from "@insuredesk/api";
import { splitPolicyNumbers, type TicketDuplicateMatchField } from "@insuredesk/shared";
import { keepPreviousData } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { ChevronDown, ChevronUp, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { formatDateTime } from "@/lib/datetime";
import { trpc } from "@/lib/trpc";
import { StatusBadge } from "./StatusBadge";
import type { TicketFormValues } from "./TicketFormFields";
import type { TicketDetail } from "./ticket-detail";

/**
 * 建单/编辑的查重提示：保单号或手机号命中未软删历史工单时，在命中字段输入框
 * 正下方挂贴身警示块（始终展开、非阻断），行点击新标签打开对应工单。提交被
 * 服务端 409 兜底拦下时，DuplicateConfirmDialog 复用同一行内容做阻断确认。
 *
 * 提示挂哪个字段由服务端的 matchedFields（输入侧字段名）决定，前端不做二次
 * 匹配。查询无结果、查询失败、字段清空都视为「无提示」——查重是辅助，永不
 * 阻塞表单本身。
 */

type DuplicateTicket = inferRouterOutputs<AppRouter>["ticket"]["findDuplicates"][number];

const FIELD_NOUN: Record<TicketDuplicateMatchField, string> = {
  policyNumbers: "保单号",
  phone: "客户电话",
  contactPhone: "联系人电话",
};

/** 手机号满 11 位即触发即时查；不足位但失焦过（touched）也查。 */
const PHONE_READY_LENGTH = 11;
const DEBOUNCE_MS = 400;

function phoneQueryable(value: string | null | undefined, touched: boolean | undefined): boolean {
  const trimmed = value?.trim() ?? "";
  return trimmed.length >= PHONE_READY_LENGTH || (touched === true && trimmed.length > 0);
}

/**
 * watch 三个查重字段 → 防抖 400ms → findDuplicates。保单号拆出 token 即查；
 * 手机号满 11 位或失焦才查。查询条件全空则停查（enabled=false），表现为无命中。
 */
export function useTicketDuplicates(
  form: UseFormReturn<TicketFormValues>,
  options?: { excludeTicketId?: string; enabled?: boolean },
) {
  const policyNumbersText = form.watch("policyNumbers");
  const phone = form.watch("phone");
  const contactPhone = form.watch("contactPhone");
  // touchedFields 由失焦置位，是「失焦触发」的信号源
  const { phone: phoneTouched, contactPhone: contactPhoneTouched } = form.formState.touchedFields;

  const input = useMemo(
    () => ({
      policyNumbers: splitPolicyNumbers(policyNumbersText ?? ""),
      phone: phoneQueryable(phone, phoneTouched) ? (phone ?? "").trim() : null,
      contactPhone: phoneQueryable(contactPhone, contactPhoneTouched)
        ? (contactPhone ?? "").trim()
        : null,
    }),
    [policyNumbersText, phone, contactPhone, phoneTouched, contactPhoneTouched],
  );

  const [debounced, setDebounced] = useState(input);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(input), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input]);

  const queryable =
    debounced.policyNumbers.length > 0 ||
    debounced.phone !== null ||
    debounced.contactPhone !== null;

  const query = trpc.ticket.findDuplicates.useQuery(
    { ...debounced, excludeTicketId: options?.excludeTicketId },
    {
      enabled: (options?.enabled ?? true) && queryable,
      // 字段连改时空 key 瞬间回空再回填会闪；保留上一份结果直到新结果到达
      placeholderData: keepPreviousData,
    },
  );

  return query.data ?? [];
}

/** 查重命中行：工单号（新标签打开）、状态、客户名、创建时间。提示块与提交确认框共用。 */
export function DuplicateTicketList({ duplicates }: { duplicates: readonly DuplicateTicket[] }) {
  return (
    <ul className="space-y-1">
      {duplicates.map((duplicate) => (
        <li key={duplicate.id} className="flex items-center gap-2 text-xs">
          <a
            href={`/tickets/${duplicate.id}`}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 font-mono underline underline-offset-2"
          >
            {duplicate.workOrderNumber}
          </a>
          <StatusBadge status={duplicate.displayStatus} />
          <span className="truncate text-muted-foreground">
            {duplicate.customerName ?? "—"} · {formatDateTime(duplicate.createdAt)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** 字段贴身警示块：只展示经该字段命中的工单，始终展开、无收起。 */
export function DuplicateFieldHint({
  field,
  duplicates,
}: {
  field: TicketDuplicateMatchField;
  duplicates: readonly DuplicateTicket[];
}) {
  const hits = duplicates.filter((duplicate) => duplicate.matchedFields.includes(field));
  if (hits.length === 0) {
    return null;
  }
  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs">
      <div className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
        <TriangleAlert className="size-3.5" />
        {hits.length} 个工单使用相同{FIELD_NOUN[field]}，确认后再提交
      </div>
      <div className="mt-1.5 border-amber-500/20 border-t pt-1.5">
        <DuplicateTicketList duplicates={hits} />
      </div>
    </div>
  );
}

/** 提交时服务端兜底命中的值快照 —— 确认框按它重查，与 409 判定同源。 */
export interface DuplicateConflictValues {
  policyNumbers: string[];
  phone: string | null;
  contactPhone: string | null;
}

/**
 * 提交 409 的阻断确认框：列出重复工单（与即时提示同一行内容），「仍要」带
 * allowDuplicate 重发由调用方执行。values=null 等价于关闭。
 */
export function DuplicateConfirmDialog({
  values,
  excludeTicketId,
  confirmLabel,
  confirming,
  onConfirm,
  onCancel,
}: {
  values: DuplicateConflictValues | null;
  excludeTicketId?: string;
  /** 「仍要创建」/「仍要保存」。 */
  confirmLabel: string;
  confirming?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const query = trpc.ticket.findDuplicates.useQuery(
    {
      policyNumbers: values?.policyNumbers ?? [],
      phone: values?.phone ?? null,
      contactPhone: values?.contactPhone ?? null,
      excludeTicketId,
    },
    { enabled: values !== null },
  );

  return (
    <Dialog
      open={values !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>发现可能重复的工单</DialogTitle>
          <DialogDescription>
            以下历史工单与当前输入的保单号或手机号相同，请先打开确认不是同一事项。
          </DialogDescription>
        </DialogHeader>
        {query.data ? (
          <div className="max-h-64 overflow-y-auto rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2">
            <DuplicateTicketList duplicates={query.data} />
          </div>
        ) : (
          <div className="flex justify-center py-4">
            <Spinner />
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} disabled={confirming}>
            取消
          </Button>
          <Button type="button" onClick={onConfirm} disabled={confirming}>
            {confirming && <Spinner data-icon="inline-start" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 详情页头部下的重复工单条幅：该客户的其他未软删工单（保单号/手机号命中、
 * 排除自身）。收起只显最近 1 条，「+N」原地展开全部（限高滚动）。条目两行：
 * 工单号新标签链接 + 状态徽标 + 最新处理时间；第二行裸文本摘要（完结单即完结
 * 备注）——不带「完结状态/最新记录」前缀，状态徽标已表达。无命中不渲染。
 */
export function DuplicateTicketsBanner({ ticket }: { ticket: TicketDetail }) {
  const queryable =
    ticket.policyNumbers.length > 0 || ticket.phone !== null || ticket.contactPhone !== null;
  const query = trpc.ticket.findDuplicates.useQuery(
    {
      policyNumbers: ticket.policyNumbers,
      phone: ticket.phone,
      contactPhone: ticket.contactPhone,
      excludeTicketId: ticket.id,
    },
    { enabled: queryable },
  );

  // 展开态绑在工单 id 上：切单后 expandedFor 失配即回落收起，无需 effect
  const [expandedFor, setExpandedFor] = useState<string | null>(null);
  const expanded = expandedFor === ticket.id;

  const dups = query.data ?? [];
  if (dups.length === 0) {
    return null;
  }
  const visible = expanded ? dups : dups.slice(0, 1);
  const hidden = dups.length - visible.length;

  return (
    <div className="border-b bg-amber-500/5 px-4 py-2 text-xs">
      <div className="flex items-start gap-3">
        <span className="flex shrink-0 items-center gap-1.5 pt-0.5 font-medium text-amber-700 dark:text-amber-400">
          <TriangleAlert className="size-3.5" />
          该客户另有 {dups.length} 个工单
        </span>
        <ul className="max-h-64 min-w-0 flex-1 divide-y overflow-y-auto">
          {visible.map((dup) => (
            <li key={dup.id} className="flex flex-col gap-0.5 py-0.5">
              <span className="flex items-center gap-1.5">
                <a
                  href={`/tickets/${dup.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 font-mono underline underline-offset-2"
                >
                  {dup.workOrderNumber}
                </a>
                <StatusBadge status={dup.displayStatus} />
                <span className="text-muted-foreground">{formatDateTime(dup.activityAt)}</span>
              </span>
              <span className="pl-1 text-muted-foreground">{dup.activityText}</span>
            </li>
          ))}
        </ul>
        {hidden > 0 && (
          <Badge
            asChild
            variant="secondary"
            className="shrink-0 cursor-pointer tabular-nums"
            aria-label={`展开其余 ${hidden} 个工单`}
          >
            <button type="button" onClick={() => setExpandedFor(ticket.id)}>
              +{hidden}
              <ChevronDown className="size-3" />
            </button>
          </Badge>
        )}
        {expanded && (
          <Badge asChild variant="secondary" className="shrink-0 cursor-pointer" aria-label="收起">
            <button type="button" onClick={() => setExpandedFor(null)}>
              收起
              <ChevronUp className="size-3" />
            </button>
          </Badge>
        )}
      </div>
    </div>
  );
}
