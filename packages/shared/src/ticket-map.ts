import { z } from "zod";
import { createdRangeFields } from "./time-range.ts";

export const ticketMapPointsInputSchema = z.object({
  ...createdRangeFields,
  userFeedbackChannelId: z.array(z.string().min(1)).optional(),
});

export type TicketMapPointsInput = z.infer<typeof ticketMapPointsInputSchema>;

/** 一个定位码一行；省份计数与「已定位」总数由前端按有坐标的行汇总。 */
export interface TicketMapLocation {
  readonly code: string;
  readonly provinceCode: string;
  readonly provinceName: string;
  readonly cityName: string | null;
  readonly districtName: string | null;
  readonly count: number;
}
