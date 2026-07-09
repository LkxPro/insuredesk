/**
 * Placeholder pages for the shell's menu entries. Each functional ticket
 * replaces one of these with a real page — the route and menu wiring in
 * AppRoutes/navigation stays untouched.
 */

function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground">功能开发中，敬请期待。</p>
    </div>
  );
}

export function DashboardPage() {
  return <PlaceholderPage title="数据看板" />;
}

export function TicketsPage() {
  return <PlaceholderPage title="工单管理" />;
}

export function UsersPage() {
  return <PlaceholderPage title="用户管理" />;
}

export function RolesPage() {
  return <PlaceholderPage title="角色权限" />;
}

export function SchedulePage() {
  return <PlaceholderPage title="排班配置" />;
}
