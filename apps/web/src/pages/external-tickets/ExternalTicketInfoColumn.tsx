import { joinPolicyNumbers } from "@insuredesk/shared";
import { DetailGrid, DetailItem } from "@/pages/ticket-surface/DetailGrid";
import {
  EXTERNAL_INFO_FIELDS,
  type ExternalInfoField,
  type ExternalTicket,
  externalFieldLabel,
} from "./external-ticket-fields";

/**
 * 外部详情的信息栏：工单原文置顶直出（原文是提交者自己贴的、没有剧透可言，
 * 折叠起来就只剩空栏），下面固定 4 个字段平铺，空值统一落 —（DetailItem
 * 兜底）。工单号与状态不渲染——它们已挂在详情头部，重复一遍白占一格。
 */
export function ExternalTicketInfoColumn({ ticket }: { ticket: ExternalTicket }) {
  const values: Record<ExternalInfoField, string | null> = {
    policyNumbers: ticket.policyNumbers?.length ? joinPolicyNumbers(ticket.policyNumbers) : null,
    customerName: ticket.customerName,
    phone: ticket.phone,
    contactPhone: ticket.contactPhone,
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 rounded-md border p-3">
        <h3 className="m-0 text-sm font-medium text-muted-foreground">工单原文</h3>
        <pre className="m-0 whitespace-pre-wrap text-sm">{ticket.submissionText || "—"}</pre>
      </div>
      <DetailGrid>
        {EXTERNAL_INFO_FIELDS.map((key) => (
          <DetailItem key={key} label={externalFieldLabel(key)}>
            {values[key] || null}
          </DetailItem>
        ))}
      </DetailGrid>
    </div>
  );
}
