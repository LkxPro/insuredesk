import { healthStatusSchema } from "@insuredesk/shared";
import { publicProcedure, router } from "../trpc";
import { authRouter } from "./auth.router";
import { dashboardRouter } from "./dashboard.router";
import { demoRouter } from "./demo.router";
import { notificationRouter } from "./notification.router";
import { scheduleRouter } from "./schedule.router";
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

  /**
   * 数据看板 - 9 指标卡 + 渠道统计 + 跟进人考核 (issue #29)
   */
  dashboard: dashboardRouter,

  /**
   * 排班配置 - 排班日历 CRUD，喂给按排班自动分配 (issue #31)
   */
  schedule: scheduleRouter,
});

export type AppRouter = typeof appRouter;
