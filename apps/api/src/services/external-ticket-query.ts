import { Prisma } from "../generated/prisma/client";

export interface ExternalTicketQueryInput {
  status?: readonly string[];
  includeCompleted: boolean;
  completionStatusId?: readonly string[];
  feedbackFrom?: string;
  feedbackTo?: string;
  search?: string;
  sortBy: "feedbackTime" | "status" | "completionStatus" | "latestActivityAt";
  sortOrder: "asc" | "desc";
}

export const EXTERNAL_VISIBLE_NON_COMMENT_ACTIONS = [
  "create",
  "external_note",
  "status_change",
  "resolve",
] as const;

/** Prisma equivalent of the raw-SQL visibility condition below. */
export const EXTERNAL_VISIBLE_PROCESS_LOG_FILTER = {
  OR: [
    ...EXTERNAL_VISIBLE_NON_COMMENT_ACTIONS.map((action) => ({ action })),
    { action: "comment", internalOnly: false },
  ],
} satisfies Prisma.ProcessLogWhereInput;

/** Public activity shared by list summaries, latest-activity sorting and export. */
export const EXTERNAL_VISIBLE_ACTIVITY_CONDITION = Prisma.sql`
  (
    p0.action IN (${Prisma.join([...EXTERNAL_VISIBLE_NON_COMMENT_ACTIONS])})
    OR (p0.action = 'comment' AND p0."internalOnly" = false)
  )
`;

/** `processingResult` on external surfaces means the latest public客服回复 only. */
export const EXTERNAL_PUBLIC_PROCESSING_RESULT_SQL = Prisma.sql`
  (
    SELECT public_comment.remark
    FROM process_logs public_comment
    WHERE public_comment."ticketId" = t.id
      AND public_comment.action = 'comment'
      AND public_comment."internalOnly" = false
    ORDER BY public_comment.at DESC, public_comment.id DESC
    LIMIT 1
  )
`;

export function buildExternalTicketWhere(
  input: ExternalTicketQueryInput,
  viewerId: string,
  searchableFields: readonly string[],
): Prisma.Sql {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`t."creatorId" = ${viewerId}`,
    Prisma.sql`t."deletedAt" IS NULL`,
  ];
  if (input.status && input.status.length > 0) {
    conditions.push(Prisma.sql`t.status IN (${Prisma.join([...input.status])})`);
  } else if (!input.includeCompleted) {
    conditions.push(Prisma.sql`t.status <> 'completed'`);
  }
  if (input.completionStatusId && input.completionStatusId.length > 0) {
    conditions.push(
      Prisma.sql`t."completionStatusId" IN (${Prisma.join([...input.completionStatusId])})`,
    );
  }
  if (input.feedbackFrom) {
    conditions.push(Prisma.sql`t."feedbackTime" >= ${new Date(input.feedbackFrom)}`);
  }
  if (input.feedbackTo) {
    conditions.push(Prisma.sql`t."feedbackTime" <= ${new Date(input.feedbackTo)}`);
  }
  if (input.search) {
    const pattern = `%${input.search}%`;
    const searchExpressions: Record<string, Prisma.Sql> = {
      submissionText: Prisma.sql`t."submissionText" ILIKE ${pattern}`,
      workOrderNumber: Prisma.sql`t."workOrderNumber" ILIKE ${pattern}`,
      project: Prisma.sql`t.project ILIKE ${pattern}`,
      brokerageEntity: Prisma.sql`t."brokerageEntity" ILIKE ${pattern}`,
      paymentChannel: Prisma.sql`t."paymentChannel" ILIKE ${pattern}`,
      policyNumbers: Prisma.sql`array_to_string(t."policyNumbers", ' ') ILIKE ${pattern}`,
      userComplaintChannel: Prisma.sql`t."userComplaintChannel" ILIKE ${pattern}`,
      complaintReceiveChannel: Prisma.sql`t."complaintReceiveChannel" ILIKE ${pattern}`,
      customerName: Prisma.sql`t."customerName" ILIKE ${pattern}`,
      nuclearBodyStatus: Prisma.sql`t."nuclearBodyStatus" ILIKE ${pattern}`,
      customerRequest: Prisma.sql`t."customerRequest" ILIKE ${pattern}`,
      complaintLevel: Prisma.sql`t."complaintLevel" ILIKE ${pattern}`,
      priority: Prisma.sql`t.priority ILIKE ${pattern}`,
      processingResult: Prisma.sql`${EXTERNAL_PUBLIC_PROCESSING_RESULT_SQL} ILIKE ${pattern}`,
    };
    const phoneDigits = input.search.replace(/\D/g, "");
    if (phoneDigits) {
      searchExpressions.phone = Prisma.sql`regexp_replace(t.phone, '[^0-9]', '', 'g') ILIKE ${`%${phoneDigits}%`}`;
    }
    const searchTerms = searchableFields.flatMap((field) => {
      const expression = searchExpressions[field];
      return expression ? [expression] : [];
    });
    conditions.push(
      searchTerms.length > 0
        ? Prisma.sql`(${Prisma.join(searchTerms, " OR ")})`
        : Prisma.sql`false`,
    );
  }

  return Prisma.join(conditions, " AND ");
}

export function externalTicketSortExpression(sortBy: ExternalTicketQueryInput["sortBy"]) {
  if (sortBy === "feedbackTime") return Prisma.sql`t."feedbackTime"`;
  if (sortBy === "status") return Prisma.sql`t.status`;
  if (sortBy === "completionStatus") return Prisma.sql`cs."displayOrder"`;
  return Prisma.sql`COALESCE(p.at, t."createdAt")`;
}

export function externalTicketSortDirection(sortOrder: ExternalTicketQueryInput["sortOrder"]) {
  return sortOrder === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;
}
