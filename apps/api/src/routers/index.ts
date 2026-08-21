import { healthStatusSchema } from "@insuredesk/shared";
import { publicProcedure, router } from "../trpc.ts";
import { authRouter } from "./auth.router.ts";
import { channelRouter } from "./channel.router.ts";
import { completionStatusRouter } from "./completion-status.router.ts";
import { dashboardRouter } from "./dashboard.router.ts";
import { demoRouter } from "./demo.router.ts";
import { externalAccountRouter } from "./external-account.router.ts";
import { externalTicketRouter } from "./external-ticket.router.ts";
import { feedbackReceiveChannelRouter } from "./feedback-receive-channel.router.ts";
import { notificationRouter } from "./notification.router.ts";
import { roleRouter } from "./role.router.ts";
import { scheduleRouter } from "./schedule.router.ts";
import { shiftTypeRouter } from "./shift-type.router.ts";
import { slaRouter } from "./sla.router.ts";
import { ticketRouter } from "./ticket.router.ts";
import { ticketCategoryRouter } from "./ticket-category.router.ts";
import { userRouter } from "./user.router.ts";
import { userFeedbackChannelRouter } from "./user-feedback-channel.router.ts";

export const appRouter = router({
  /**
   * Liveness probe consumed by the web client end-to-end. The timestamp here is
   * a heartbeat for observability, not a business time predicate, so it is
   * exempt from the "no bare new Date()" rule that governs SLA logic.
   */
  health: publicProcedure.output(healthStatusSchema).query(() => ({
    status: "ok" as const,
    service: "insuredesk-api",
    timestamp: new Date().toISOString(),
    uptimeSeconds: process.uptime(),
  })),

  auth: authRouter,

  demo: demoRouter,

  ticket: ticketRouter,

  ticketCategory: ticketCategoryRouter,

  channel: channelRouter,

  completionStatus: completionStatusRouter,

  userFeedbackChannel: userFeedbackChannelRouter,

  feedbackReceiveChannel: feedbackReceiveChannelRouter,

  notification: notificationRouter,

  dashboard: dashboardRouter,

  schedule: scheduleRouter,

  shiftType: shiftTypeRouter,

  user: userRouter,

  role: roleRouter,

  sla: slaRouter,

  externalAccount: externalAccountRouter,

  externalTicket: externalTicketRouter,
});

export type AppRouter = typeof appRouter;
