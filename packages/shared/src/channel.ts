import { z } from "zod";

/**
 * 反馈渠道目录 contracts (issue #69). Tickets reference catalog rows by id, so
 * a rename propagates everywhere at read time; only the ProcessLog remark
 * keeps the literal name snapshot of the moment. `regulatory` marks the rows
 * whose tickets count into the dashboard's 监管单数 card.
 */

const channelFields = {
  name: z.string().trim().min(1, "请填写渠道名称").max(50, "渠道名称最多 50 个字符"),
  displayOrder: z.number().int("显示顺序必须为整数"),
  regulatory: z.boolean(),
};

export const channelCreateInputSchema = z.object(channelFields);
export type ChannelCreateInput = z.infer<typeof channelCreateInputSchema>;

export const channelUpdateInputSchema = z.object({
  id: z.string().min(1),
  ...channelFields,
});
export type ChannelUpdateInput = z.infer<typeof channelUpdateInputSchema>;

export const channelSetActiveInputSchema = z.object({
  id: z.string().min(1),
  active: z.boolean(),
});
export type ChannelSetActiveInput = z.infer<typeof channelSetActiveInputSchema>;

export const channelDeleteInputSchema = z.object({ id: z.string().min(1) });
export type ChannelDeleteInput = z.infer<typeof channelDeleteInputSchema>;
