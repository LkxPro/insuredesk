import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { CalendarClock, LayoutDashboard, ShieldCheck, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * Placeholder pages for the shell's menu entries. Each functional ticket
 * replaces one of these with a real page — the route and menu wiring in
 * AppRoutes/navigation stays untouched.
 */

function PlaceholderPage({ title, icon: Icon }: { title: string; icon: LucideIcon }) {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <Empty className="flex-1 border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Icon />
          </EmptyMedia>
          <EmptyTitle>功能开发中</EmptyTitle>
          <EmptyDescription>{title}即将上线，敬请期待。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}

export function DashboardPage() {
  return <PlaceholderPage title="数据看板" icon={LayoutDashboard} />;
}

export function UsersPage() {
  return <PlaceholderPage title="用户管理" icon={Users} />;
}

export function RolesPage() {
  return <PlaceholderPage title="角色权限" icon={ShieldCheck} />;
}

export function SchedulePage() {
  return <PlaceholderPage title="排班配置" icon={CalendarClock} />;
}
