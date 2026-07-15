import type { Permission } from "@insuredesk/shared";
import {
  CalendarClock,
  CalendarDays,
  LayoutDashboard,
  ShieldCheck,
  Ticket,
  Timer,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * Single source of truth for the app shell navigation. Each entry maps 1:1
 * to a page permission point: the sidebar only renders entries the current
 * user holds, and the route for `path` is guarded by the same `permission`
 * — so menu visibility and URL access can never disagree.
 */

export interface NavItem {
  path: string;
  label: string;
  permission: Permission;
  icon: LucideIcon;
}

export const NAV_ITEMS = [
  { path: "/dashboard", label: "数据看板", permission: "dashboard.view", icon: LayoutDashboard },
  { path: "/tickets", label: "工单管理", permission: "ticket.view", icon: Ticket },
  { path: "/users", label: "用户管理", permission: "user.view", icon: Users },
  { path: "/roles", label: "角色权限", permission: "role.view", icon: ShieldCheck },
  { path: "/schedule", label: "排班表", permission: "schedule.view", icon: CalendarDays },
  {
    path: "/shift-types",
    label: "班次管理",
    permission: "schedule.manage_shifts",
    icon: CalendarClock,
  },
  { path: "/sla", label: "SLA 策略", permission: "sla.view", icon: Timer },
] as const satisfies readonly NavItem[];

/** Literal union of shell page paths — keeps the path→page map compile-time complete. */
export type NavPath = (typeof NAV_ITEMS)[number]["path"];

/**
 * Menu entries the given permission set is allowed to see, in NAV_ITEMS order.
 * Accepts plain strings because the permission list arrives from the server.
 */
export function visibleNavItems(permissions: readonly string[]): NavItem[] {
  return NAV_ITEMS.filter((item) => permissions.includes(item.permission));
}
