import {
  type CallbackDeliveryStatus,
  REFUND_AMOUNT_PATTERN,
  TICKET_TEXT_LIMITS,
} from "@insuredesk/shared";
import { Check, Copy, Pencil, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/contexts/AuthContext";
import { formatDateTime } from "@/lib/datetime";
import { toast } from "@/lib/toast";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import type { TicketDetail } from "./ticket-detail";

const DELIVERY_STATUS_LABELS: Record<CallbackDeliveryStatus, string> = {
  pending: "待投递",
  delivered: "已投递",
  dead: "投递失败（死信）",
};

const COMPENSATION_FORMAT_MESSAGE = "补偿金须为不小于 0 的金额（最多两位小数）";
const CONTACT_PHONE_MAX = TICKET_TEXT_LIMITS.contactPhone;
const CONTACT_PHONE_LENGTH_MESSAGE = `联系人电话不能超过 ${CONTACT_PHONE_MAX} 个字符`;

type RefundDetail = NonNullable<TicketDetail["refundDetail"]>;

type InlineEditor = {
  editing: boolean;
  draft: string;
  setDraft: (value: string) => void;
  error: string | null;
  pending: boolean;
  current: string | null;
  canEdit: boolean;
  start: () => void;
  cancel: () => void;
  save: () => void;
};

function useCompensationEditor(ticket: TicketDetail): InlineEditor {
  const { hasPermission } = useAuth();
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mutation = trpc.ticket.updateRefundCompensation.useMutation({
    onSuccess: () => {
      toast.success("补偿金已更新");
      setEditing(false);
      setError(null);
      utils.ticket.detail.invalidate();
    },
    onError: (mutationError) => setError(mutationError.message),
  });

  const current = ticket.refundDetail?.compensationAmount ?? null;

  const save = () => {
    const value = draft.trim();
    if (value !== "" && !REFUND_AMOUNT_PATTERN.test(value)) {
      setError(COMPENSATION_FORMAT_MESSAGE);
      return;
    }
    mutation.mutate({ ticketId: ticket.id, compensationAmount: value === "" ? null : value });
  };

  return {
    editing,
    draft,
    setDraft,
    error,
    pending: mutation.isPending,
    current,
    canEdit: hasPermission("ticket.process") && ticket.status !== "completed",
    start: () => {
      setDraft(current ?? "");
      setError(null);
      setEditing(true);
    },
    cancel: () => {
      setEditing(false);
      setError(null);
    },
    save,
  };
}

function useContactPhoneEditor(ticket: TicketDetail): InlineEditor {
  const { hasPermission } = useAuth();
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mutation = trpc.ticket.editRefund.useMutation({
    onSuccess: () => {
      toast.success("联系人电话已更新");
      setEditing(false);
      setError(null);
      utils.ticket.detail.invalidate();
    },
    onError: (mutationError) => setError(mutationError.message),
  });

  const current = ticket.contactPhone ?? null;

  const save = () => {
    const value = draft.trim();
    if (value.length > CONTACT_PHONE_MAX) {
      setError(CONTACT_PHONE_LENGTH_MESSAGE);
      return;
    }
    // slaPolicyId 必须原样回传：editRefund 服务端按全量字段落地，漏传会清掉时效策略
    mutation.mutate({
      ticketId: ticket.id,
      contactPhone: value === "" ? null : value,
      slaPolicyId: ticket.slaPolicy?.id ?? null,
    });
  };

  return {
    editing,
    draft,
    setDraft,
    error,
    pending: mutation.isPending,
    current,
    canEdit: hasPermission("ticket.edit"),
    start: () => {
      setDraft(current ?? "");
      setError(null);
      setEditing(true);
    },
    cancel: () => {
      setEditing(false);
      setError(null);
    },
    save,
  };
}

function EditableValue({
  editor,
  label,
  emptyText,
  placeholder,
}: {
  editor: InlineEditor;
  label: string;
  emptyText?: string;
  placeholder: string;
}) {
  if (!editor.editing) {
    return (
      <span className="flex w-full min-w-0 items-center gap-1">
        <span className="min-w-0 flex-1 break-all">{editor.current ?? emptyText ?? "—"}</span>
        {editor.canEdit && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={`修改${label}`}
            title={`修改${label}`}
            onClick={editor.start}
            className="text-muted-foreground hover:text-foreground"
          >
            <Pencil className="size-3.5" />
          </Button>
        )}
      </span>
    );
  }
  return (
    <span className="flex min-w-0 flex-col gap-1">
      <span className="flex min-w-0 items-center gap-1.5">
        <Input
          aria-label={label}
          className="h-8 min-w-0 flex-1"
          placeholder={placeholder}
          value={editor.draft}
          onChange={(event) => editor.setDraft(event.target.value)}
          aria-invalid={editor.error !== null}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="保存"
          title="保存"
          onClick={editor.save}
          disabled={editor.pending}
          className="text-muted-foreground hover:text-foreground"
        >
          {editor.pending ? <Spinner className="size-3" /> : <Check className="size-3.5" />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="取消"
          title="取消"
          onClick={editor.cancel}
          disabled={editor.pending}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" />
        </Button>
      </span>
      {editor.error && <span className="text-xs text-destructive">{editor.error}</span>}
    </span>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      toast.error("复制失败，请手动选择文本复制");
    }
  };
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={`复制${label}`}
      title={`复制${label}`}
      onClick={copy}
      className="text-muted-foreground hover:text-foreground"
    >
      {copied ? <Check className="size-3.5 text-green-600" /> : <Copy className="size-3.5" />}
    </Button>
  );
}

function SectionShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="m-0 text-sm font-medium text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function GridField({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="m-0 min-w-0 text-sm">{children ?? "—"}</dd>
    </div>
  );
}

function LedgerRow({
  label,
  mono,
  copyValue,
  children,
}: {
  label: string;
  mono?: boolean;
  copyValue?: string | null;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <dt className="w-[7em] shrink-0 pt-0.5 text-xs text-muted-foreground">{label}</dt>
      <dd className="m-0 flex min-w-0 flex-1 items-center gap-1 text-sm">
        <span
          className={cn("min-w-0 flex-1", mono ? "break-all font-mono text-[13px]" : "break-words")}
        >
          {children ?? "—"}
        </span>
        {copyValue != null && copyValue !== "" && <CopyButton value={copyValue} label={label} />}
      </dd>
    </div>
  );
}

function ContactSection({
  ticket,
  detail,
  contactPhoneField,
}: {
  ticket: TicketDetail;
  detail: RefundDetail;
  contactPhoneField?: ReactNode;
}) {
  const compensation = useCompensationEditor(ticket);
  const contactPhone = useContactPhoneEditor(ticket);
  return (
    <SectionShell title="客户与补偿">
      <dl className="m-0 grid gap-x-6 gap-y-3 sm:grid-cols-[repeat(2,minmax(0,1fr))]">
        <GridField label="投保人姓名">{detail.holderName}</GridField>
        <GridField label="补偿金">
          <EditableValue
            editor={compensation}
            label="补偿金"
            emptyText="无补偿"
            placeholder="留空 = 无补偿"
          />
        </GridField>
        <GridField label="投保人手机号码">{detail.holderPhone}</GridField>
        {contactPhoneField ?? (
          <GridField label="联系人电话（备用）">
            <EditableValue editor={contactPhone} label="联系人电话" placeholder="留空 = 未填写" />
          </GridField>
        )}
      </dl>
    </SectionShell>
  );
}

function DeliveryCell({ delivery }: { delivery: NonNullable<TicketDetail["callbackDelivery"]> }) {
  const { hasPermission } = useAuth();
  const utils = trpc.useUtils();
  const redeliver = trpc.ticket.redeliverCallback.useMutation({
    onSuccess: () => {
      toast.success("已重置为待投递");
      utils.ticket.detail.invalidate();
    },
    onError: (mutationError) => toast.error(mutationError.message),
  });

  return (
    <span className="flex flex-col gap-1">
      <span className="inline-flex items-center gap-2">
        {DELIVERY_STATUS_LABELS[delivery.status]}
        {delivery.status === "delivered" && delivery.deliveredAt !== null && (
          <span className="text-muted-foreground">{formatDateTime(delivery.deliveredAt)}</span>
        )}
        {delivery.status === "dead" && hasPermission("ticket.process") && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => redeliver.mutate({ deliveryId: delivery.id })}
            disabled={redeliver.isPending}
          >
            {redeliver.isPending && <Spinner data-icon="inline-start" />}
            重新投递
          </Button>
        )}
      </span>
      {delivery.lastError && <span className="text-xs text-destructive">{delivery.lastError}</span>}
    </span>
  );
}

function TradesTable({ trades }: { trades: RefundDetail["refundTrades"] }) {
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr className="text-left text-xs text-muted-foreground">
          <th className="border-b py-1 pr-4 font-normal">期数</th>
          <th className="border-b py-1 pr-4 font-normal">支付流水号</th>
          <th className="border-b py-1 font-normal">应退金额</th>
        </tr>
      </thead>
      <tbody>
        {trades.map((trade) => (
          <tr key={trade.tradeNo}>
            <td className="border-b py-1 pr-4">{trade.tradeNo}</td>
            <td className="border-b py-1 pr-4">{trade.payNo}</td>
            <td className="border-b py-1">{trade.expectedAmount}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RefundLedger({ ticket, detail }: { ticket: TicketDetail; detail: RefundDetail }) {
  return (
    <dl className="m-0 divide-y divide-border">
      <LedgerRow label="工单类型">{detail.workOrderType}</LedgerRow>
      <LedgerRow label="异常原因">{detail.failureReason}</LedgerRow>
      <LedgerRow label="应退金额">{detail.expectedAmount}</LedgerRow>
      <LedgerRow label="退费申请时间">{formatDateTime(detail.refundCreateTime)}</LedgerRow>
      <LedgerRow label="系统订单号" mono copyValue={detail.sysOrderId}>
        {detail.sysOrderId}
      </LedgerRow>
      <LedgerRow label="退费申请号" mono copyValue={detail.endorNo}>
        {detail.endorNo}
      </LedgerRow>
      <LedgerRow label="保单号" mono copyValue={detail.policyNo}>
        {detail.policyNo}
      </LedgerRow>
      <LedgerRow label="保司名称">{detail.companyName}</LedgerRow>
      <LedgerRow label="产品名称">{detail.productName}</LedgerRow>
      <LedgerRow label="回调投递状态">
        {ticket.callbackDelivery === null ? null : (
          <DeliveryCell delivery={ticket.callbackDelivery} />
        )}
      </LedgerRow>
      <div className="py-1.5">
        <dt className="text-xs text-muted-foreground">期次明细</dt>
        <dd className="m-0 mt-1 min-w-0 text-sm">
          <TradesTable trades={detail.refundTrades} />
        </dd>
      </div>
    </dl>
  );
}

export function RefundModule({
  ticket,
  contactPhoneField,
}: {
  ticket: TicketDetail;
  contactPhoneField?: ReactNode;
}) {
  const detail = ticket.refundDetail;
  if (detail === null) {
    return null;
  }
  return (
    <>
      <ContactSection ticket={ticket} detail={detail} contactPhoneField={contactPhoneField} />
      <SectionShell title="退费信息">
        <RefundLedger ticket={ticket} detail={detail} />
      </SectionShell>
    </>
  );
}
