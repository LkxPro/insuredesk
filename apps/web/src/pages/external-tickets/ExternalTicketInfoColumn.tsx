import { joinPolicyNumbers, TICKET_FIELDS } from "@insuredesk/shared";
import { DetailGrid, DetailItem } from "@/pages/ticket-surface/DetailGrid";
import {
  EXTERNAL_INFO_FIELDS,
  type ExternalInfoField,
  type ExternalTicket,
  externalFieldLabel,
} from "./external-ticket-fields";

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
        <DetailItem label={TICKET_FIELDS.slaPolicyId.label}>
          {ticket.slaPolicyName || null}
        </DetailItem>
      </DetailGrid>
    </div>
  );
}
