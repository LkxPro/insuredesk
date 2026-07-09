import { healthStatusSchema } from "@insuredesk/shared";
import { publicProcedure, router } from "../trpc";
import { authRouter } from "./auth.router";
import { demoRouter } from "./demo.router";
import { notificationRouter } from "./notification.router";
import { ticketRouter } from "./ticket.router";

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

  /**
   * Authentication routes - me query
   */
  auth: authRouter,

  /**
   * Demo routes - RBAC guard testing
   */
  demo: demoRouter,

  /**
   * Ticket routes - manual creation + detail timeline (issue #22)
   */
  ticket: ticketRouter,

  /**
   * 轨 1 收件箱 - assigned notifications: poll payload + read state (issue #25)
   */
  notification: notificationRouter,
});

export type AppRouter = typeof appRouter;
