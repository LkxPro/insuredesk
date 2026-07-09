import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { visibleNavItems } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { LogOut, Menu } from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router";

/**
 * Authenticated app shell: sidebar navigation filtered by the current user's
 * page permissions, plus a top bar. Feature pages render into the Outlet.
 * On small screens the sidebar becomes an overlay behind a hamburger toggle.
 */
export function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const items = visibleNavItems(user?.permissions ?? []);

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="flex min-h-screen">
      {sidebarOpen && (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          aria-label="关闭菜单"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-border bg-card text-card-foreground transition-transform md:static md:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-14 shrink-0 items-center border-b border-border px-4 text-lg font-semibold tracking-tight">
          InsureDesk
        </div>

        <nav aria-label="主导航" className="flex-1 space-y-1 overflow-y-auto p-3">
          {items.map(({ path, label, icon: Icon }) => (
            <NavLink
              key={path}
              to={path}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-secondary text-secondary-foreground"
                    : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
                )
              }
            >
              <Icon className="size-4 shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="space-y-3 border-t border-border p-4">
          {user && (
            <div>
              <p className="text-sm font-medium">{user.name}</p>
              <p className="text-xs text-muted-foreground">
                @{user.username} · {user.roleName}
              </p>
            </div>
          )}
          <Button variant="outline" size="sm" className="w-full" onClick={handleLogout}>
            <LogOut />
            退出登录
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
          <Button
            variant="outline"
            size="icon"
            className="md:hidden"
            aria-label="打开菜单"
            onClick={() => setSidebarOpen((open) => !open)}
          >
            <Menu />
          </Button>
          <div className="flex-1" />
          <ThemeToggle />
        </header>

        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
