import { type CallbackDeliveryStatus, REFUND_AMOUNT_PATTERN } from "@insuredesk/shared";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/contexts/AuthContext";
import { formatDateTime } from "@/lib/datetime";
import { toast } from "@/lib/toast";
import { trpc } from "@/lib/trpc";
import { DetailItem as Item, DetailSection as Section } from "@/pages/ticket-surface/DetailGrid";
import type { TicketDetail } from "./ticket-detail";

const DELIVERY_STATUS_LABELS: Record<CallbackDeliveryStatus, string> = {
  pending: "待投递",
  delivered: "已投递",
  dead: "投递失败（死信）",
};

const COMPENSATION_FORMAT_MESSAGE = "补偿金须为不小于 0 的金额（最多两位小数）";

function CompensationCell({ ticket }: { ticket: TicketDetail }) {
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
  const canEdit = hasPermission("ticket.process") && ticket.status !== "completed";

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-2">
        {current ?? "无补偿"}
        {canEdit && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setDraft(current ?? "");
              setEditing(true);
            }}
          >
            修改
          </Button>
        )}
      </span>
    );
  }

  const save = () => {
    const value = draft.trim();
    if (value !== "" && !REFUND_AMOUNT_PATTERN.test(value)) {
      setError(COMPENSATION_FORMAT_MESSAGE);
      return;
    }
    mutation.mutate({ ticketId: ticket.id, compensationAmount: value === "" ? null : value });
  };

  return (
    <span className="flex flex-col gap-1">
      <span className="flex items-center gap-2">
        <Input
          aria-label="补偿金"
          className="w-40"
          placeholder="留空 = 无补偿"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          aria-invalid={error !== null}
        />
        <Button type="button" size="sm" onClick={save} disabled={mutation.isPending}>
          {mutation.isPending && <Spinner data-icon="inline-start" />}
          保存
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setEditing(false);
            setError(null);
          }}
          disabled={mutation.isPending}
        >
          取消
        </Button>
      </span>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
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

export function RefundModule({ ticket }: { ticket: TicketDetail }) {
  const detail = ticket.refundDetail;
  if (detail === null) {
    return null;
  }
  return (
    <Section title="退费信息">
      <Item label="工单类型">{detail.workOrderType}</Item>
      <Item label="异常原因">{detail.failureReason}</Item>
      <Item label="应退金额">{detail.expectedAmount}</Item>
      <Item label="退费申请时间">{formatDateTime(detail.refundCreateTime)}</Item>
      <Item label="系统订单号">{detail.sysOrderId}</Item>
      <Item label="退费申请号">{detail.endorNo}</Item>
      <Item label="保司名称">{detail.companyName}</Item>
      <Item label="产品名称">{detail.productName}</Item>
      <Item label="投保人姓名">{detail.holderName}</Item>
      <Item label="投保人手机号码">{detail.holderPhone}</Item>
      <Item label="保单号">{detail.policyNo}</Item>
      <Item label="补偿金">
        <CompensationCell ticket={ticket} />
      </Item>
      <Item label="回调投递状态">
        {ticket.callbackDelivery === null ? null : (
          <DeliveryCell delivery={ticket.callbackDelivery} />
        )}
      </Item>
      <div className="flex flex-col gap-0.5 sm:col-span-2 xl:col-span-3">
        <dt className="text-xs text-muted-foreground">期次明细</dt>
        <dd className="m-0 text-sm">
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="border-b py-1 pr-4 font-normal">期数</th>
                <th className="border-b py-1 pr-4 font-normal">支付流水号</th>
                <th className="border-b py-1 font-normal">应退金额</th>
              </tr>
            </thead>
            <tbody>
              {detail.refundTrades.map((trade) => (
                <tr key={trade.tradeNo}>
                  <td className="border-b py-1 pr-4">{trade.tradeNo}</td>
                  <td className="border-b py-1 pr-4">{trade.payNo}</td>
                  <td className="border-b py-1">{trade.expectedAmount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </dd>
      </div>
    </Section>
  );
}
