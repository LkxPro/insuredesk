import { TICKET_MESSAGE_ACTIONS, type TicketMessageAction } from "@insuredesk/shared";
import { Prisma, type PrismaClient } from "../generated/prisma/client.ts";

export async function latestTicketMessages(prisma: PrismaClient, ticketIds: readonly string[]) {
  if (ticketIds.length === 0)
    return new Map<string, { remark: string; action: TicketMessageAction }>();

  // PostgreSQL 的空白分类与 JS trim 不同；显式覆盖 ECMAScript 的空白字符。
  const whitespace =
    "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff";
  const rows = await prisma.$queryRaw<
    Array<{ ticketId: string; remark: string; action: TicketMessageAction }>
  >(Prisma.sql`
    SELECT visible.id AS "ticketId", message.remark, message.action
    FROM unnest(ARRAY[${Prisma.join(ticketIds)}]::text[]) AS visible(id)
    CROSS JOIN LATERAL (
      SELECT remark, action FROM process_logs
      WHERE "ticketId" = visible.id
        AND action IN (${Prisma.join(TICKET_MESSAGE_ACTIONS)})
        AND btrim(remark, ${whitespace}) <> ''
      ORDER BY at DESC, id DESC
      LIMIT 1
    ) AS message
  `);
  return new Map(rows.map((row) => [row.ticketId, { remark: row.remark, action: row.action }]));
}
