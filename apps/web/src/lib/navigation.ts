import type { Permission } from "@insuredesk/shared";
import type { LucideIcon } from "lucide-react";
import {
  CalendarClock,
  CalendarDays,
  Inbox,
  LayoutDashboard,
  ShieldCheck,
  Tags,
  Ticket,
  Timer,
  UserRound,
  Users,
} from "lucide-react";

/**
 * 内外部账号是两套互斥视图，permission 一维分不开：管理员展开后同样持有
 * 外部权限点，却是内部账号。故 `audience` 标注条目属于哪一侧，由
 * isExternal（外部角色判定）二分，与权限点判定叠加。
 */

/** internal = 仅内部账号可见；external = 仅外部账号可见；缺省 = 两侧都可见。 */
export type NavAudience = "internal" | "external";

export interface NavItem {
  path: string;
  label: string;
  permission: Permission;
  icon: LucideIcon;
  audience?: NavAudience;
}

export const NAV_ITEMS = [
  { path: "/dashboard", label: "数据看板", permission: "dashboard.view", icon: LayoutDashboard },
  {
    path: "/external-tickets",
    label: "我的工单",
    permission: "ticket.create_external",
    icon: Inbox,
    audience: "external",
  },
  {
    path: "/tickets",
    label: "工单管理",
    permission: "ticket.view",
    icon: Ticket,
    audience: "internal",
  },
  { path: "/users", label: "用户管理", permission: "user.view", icon: Users },
  {
    path: "/external-accounts",
    label: "外部账号管理",
    permission: "external_account.manage",
    icon: UserRound,
  },
  { path: "/roles", label: "角色权限", permission: "role.view", icon: ShieldCheck },
  { path: "/schedule", label: "排班表", permission: "schedule.view", icon: CalendarDays },
  {
    path: "/shift-types",
    label: "班次管理",
    permission: "schedule.manage_shifts",
    icon: CalendarClock,
  },
  { path: "/sla", label: "SLA 策略", permission: "sla.view", icon: Timer },
  { path: "/dictionary", label: "字典管理", permission: "dictionary.manage", icon: Tags },
] as const satisfies readonly NavItem[];

export type NavPath = (typeof NAV_ITEMS)[number]["path"];

export function visibleNavItems(permissions: readonly string[], isExternal = false): NavItem[] {
  const audience: NavAudience = isExternal ? "external" : "internal";
  return NAV_ITEMS.filter((item) => {
    // `as const` keeps the audience key off entries that don't declare one
    const itemAudience = "audience" in item ? item.audience : undefined;
    return (
      permissions.includes(item.permission) &&
      (itemAudience === undefined || itemAudience === audience)
    );
  });
}
