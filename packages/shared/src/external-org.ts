import { z } from "zod";

export const externalOrgCreateInputSchema = z.object({
  name: z.string().min(1, "机构名称不能为空").max(100),
  channelId: z.string().optional(),
  visibleTicketFields: z.array(z.string()).optional(),
});

export const externalOrgUpdateInputSchema = z.object({
  id: z.string(),
  name: z.string().min(1, "机构名称不能为空").max(100).optional(),
  channelId: z.string().optional().nullable(),
  visibleTicketFields: z.array(z.string()).optional().nullable(),
});

export const externalOrgSetActiveInputSchema = z.object({
  id: z.string(),
  active: z.boolean(),
});

export const externalOrgGetInputSchema = z.object({
  id: z.string(),
});

export type ExternalOrgCreateInput = z.infer<typeof externalOrgCreateInputSchema>;
export type ExternalOrgUpdateInput = z.infer<typeof externalOrgUpdateInputSchema>;
export type ExternalOrgSetActiveInput = z.infer<typeof externalOrgSetActiveInputSchema>;
export type ExternalOrgGetInput = z.infer<typeof externalOrgGetInputSchema>;

export interface ExternalOrgListItem {
  id: string;
  name: string;
  channelId: string | null;
  channelName: string | null;
  /** 自定义可见字段白名单；null = 系统默认。 */
  visibleTicketFields: string[] | null;
  userCount: number;
  active: boolean;
}
