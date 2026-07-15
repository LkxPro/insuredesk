import { healthStatusSchema } from "@insuredesk/shared";
import { publicProcedure, router } from "../trpc";
import { authRouter } from "./auth.router";
import { dashboardRouter } from "./dashboard.router";
import { demoRouter } from "./demo.router";
import { notificationRouter } from "./notification.router";
import { roleRouter } from "./role.router";
import { shiftTypeRouter } from "./shift-type.router";
import { slaRouter } from "./sla.router";
import { ticketRouter } from "./ticket.router";
import { userRouter } from "./user.router";

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

  /**
   * Demo routes - RBAC guard testing
   */
  demo: demoRouter,

  ticket: ticketRouter,

  /**
   * The 30s poll — 轨 1 收件箱 + 轨 2 我的待办 in one request
   */
  notification: notificationRouter,

  /**
   * 数据看板 - 9 指标卡 + 渠道统计 + 跟进人考核
   */
  dashboard: dashboardRouter,

  /** 管理员配置班次名称、颜色、多时段与显示顺序。 */
  shiftType: shiftTypeRouter,

  /**
   * 用户管理 - 新增/编辑/禁用启用/分配角色
   */
  user: userRouter,

  /**
   * 角色管理 - 权限点清单配置，管理员（系统角色）全锁
   */
  role: roleRouter,

  /**
   * SLA 策略配置 - 按投诉等级编辑首响/超时/提醒规则，限管理员
   */
  sla: slaRouter,
});

export type AppRouter = typeof appRouter;
