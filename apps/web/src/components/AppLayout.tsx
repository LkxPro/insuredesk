import { NotificationBell } from "@/components/NotificationBell";
import { ThemeToggle } from "@/components/ThemeToggle";
import { TodoBell } from "@/components/TodoBell";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { useAuth } from "@/contexts/AuthContext";
import { visibleNavItems } from "@/lib/navigation";
import { LifeBuoy, LogOut } from "lucide-react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";

/**
 * Authenticated app shell on the official shadcn Sidebar: collapsible to an
 * icon rail on desktop (Cmd/Ctrl+B or the rail edge), an offcanvas sheet on
 * mobile. Menu entries are filtered by the current user's page permissions;
 * feature pages render into the SidebarInset outlet.
 */

function AppSidebar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { setOpenMobile } = useSidebar();

  const items = visibleNavItems(user?.permissions ?? []);

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            {/* asChild <div>: brand row gets the menu-button collapse styling
                without pretending to be an interactive button. */}
            <SidebarMenuButton size="lg" asChild>
              <div>
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <LifeBuoy className="size-4" />
                </div>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate font-semibold">InsureDesk</span>
                  <span className="truncate text-xs text-sidebar-foreground/70">客服工单系统</span>
                </div>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <nav aria-label="主导航">
              <SidebarMenu>
                {items.map(({ path, label, icon: Icon }) => (
                  <SidebarMenuItem key={path}>
                    <SidebarMenuButton
                      asChild
                      isActive={pathname === path || pathname.startsWith(`${path}/`)}
                      tooltip={label}
                    >
                      <NavLink to={path} onClick={() => setOpenMobile(false)}>
                        <Icon />
                        <span>{label}</span>
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </nav>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          {user && (
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" asChild>
                <div>
                  <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-accent text-xs font-medium text-sidebar-accent-foreground">
                    {user.name.slice(0, 1)}
                  </div>
                  <div className="grid flex-1 text-left leading-tight">
                    <span className="truncate text-sm font-medium">{user.name}</span>
                    <span className="truncate text-xs text-sidebar-foreground/70">
                      @{user.username} · {user.roleName}
                    </span>
                  </div>
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          <SidebarMenuItem>
            <SidebarMenuButton onClick={handleLogout} tooltip="退出登录">
              <LogOut />
              <span>退出登录</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

export function AppLayout() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
          <div className="flex-1" />
          <TodoBell />
          <NotificationBell />
          <ThemeToggle />
        </header>
        <main className="flex flex-1 flex-col p-4 md:p-6">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
