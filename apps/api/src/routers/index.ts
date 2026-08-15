import { healthStatusSchema } from "@insuredesk/shared";
import { publicProcedure, router } from "../trpc.ts";
import { authRouter } from "./auth.router.ts";
import { channelRouter } from "./channel.router.ts";
import { completionStatusRouter } from "./completion-status.router.ts";
import { dashboardRouter } from "./dashboard.router.ts";
import { demoRouter } from "./demo.router.ts";
import { externalAccountRouter } from "./external-account.router.ts";
import { externalTicketRouter } from "./external-ticket.router.ts";
import { notificationRouter } from "./notification.router.ts";
import { roleRouter } from "./role.router.ts";
import { scheduleRouter } from "./schedule.router.ts";
import { shiftTypeRouter } from "./shift-type.router.ts";
import { slaRouter } from "./sla.router.ts";
import { ticketRouter } from "./ticket.router.ts";
import { ticketCategoryRouter } from "./ticket-category.router.ts";
import { userRouter } from "./user.router.ts";

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

  /** 字典目录 - 客诉类别的增删改名/排序/停用，限 dictionary.manage */
  ticketCategory: ticketCategoryRouter,

  /** 字典目录 - 反馈渠道，同上 */
  channel: channelRouter,

  /** 字典目录 - 完结状态，同上 */
  completionStatus: completionStatusRouter,

  /**
   * The 30s poll — 轨 1 收件箱 + 轨 2 我的待办 in one request
   */
  notification: notificationRouter,

  /**
   * 数据看板 - 9 指标卡 + 渠道统计 + 跟进人考核
   */
  dashboard: dashboardRouter,

  schedule: scheduleRouter,

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

  /**
   * 外部账号管理 - 建号/编辑(含预填与白名单)/启停
   */
  externalAccount: externalAccountRouter,

  /**
   * 外部工单 API - 提交/列表/详情，限外部用户
   */
  externalTicket: externalTicketRouter,
});

export type AppRouter = typeof appRouter;
