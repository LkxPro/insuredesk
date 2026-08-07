import { DetailGrid, DetailItem } from "@/pages/tickets/DetailGrid";
import {
  type ExternalTicket,
  externalFieldLabel,
  externalFieldValue,
} from "./external-ticket-fields";

/** 外部详情严格按管理员配置顺序渲染全部授权字段，空值统一显示为 —。 */

export function ExternalTicketInfoColumn({
  ticket,
  visibleFields,
}: {
  ticket: ExternalTicket;
  visibleFields: readonly string[];
}) {
  const fields = visibleFields.map((key) => ({ key, value: externalFieldValue(ticket, key) }));

  if (fields.length === 0) {
    return <p className="m-0 text-sm text-muted-foreground">客服团队还未补充工单信息。</p>;
  }

  return (
    <DetailGrid>
      {fields.map(({ key, value }) => (
        <DetailItem key={key} label={externalFieldLabel(key)}>
          {value === null || value === "" ? (
            "—"
          ) : key === "submissionText" ? (
            <pre className="m-0 whitespace-pre-wrap text-sm">{value}</pre>
          ) : (
            value
          )}
        </DetailItem>
      ))}
    </DetailGrid>
  );
}
