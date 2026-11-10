export const TICKET_MESSAGE_ACTIONS = ["comment", "internal_note", "external_note"] as const;

export function isTicketMessage<T extends { action: string; remark: string | null }>(
  log: T,
): log is T & { remark: string } {
  return TICKET_MESSAGE_ACTIONS.some((action) => action === log.action) && !!log.remark?.trim();
}
