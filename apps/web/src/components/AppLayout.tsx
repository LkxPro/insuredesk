import { LifeBuoy } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { NavUser } from "@/components/NavUser";
import { NotificationBell } from "@/components/NotificationBell";
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
import {
  isChangelogUnread,
  lastSeenChangelogVersion,
  latestChangelogVersion,
  onChangelogSeen,
} from "@/lib/changelog";
import { visibleNavItems } from "@/lib/navigation";

// Baked into the bundle at build time (Docker build-arg → Vite env); "dev"
// marks an un-injected build.
const appVersion = import.meta.env.VITE_APP_VERSION || "dev";

function AppSidebar() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const { setOpenMobile } = useSidebar();

  const items = visibleNavItems(user?.permissions ?? [], user?.isExternal ?? false);

  const [changelogUnread, setChangelogUnread] = useState(() =>
    isChangelogUnread(latestChangelogVersion, lastSeenChangelogVersion()),
  );
  useEffect(
    () =>
      onChangelogSeen(() =>
        setChangelogUnread(isChangelogUnread(latestChangelogVersion, lastSeenChangelogVersion())),
      ),
    [],
  );

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
        <NavUser />
        <Link
          to="/changelog"
          aria-label={changelogUnread ? `版本 ${appVersion}（有未读更新）` : `版本 ${appVersion}`}
          className="relative w-fit px-2 text-xs text-sidebar-foreground/70 hover:text-sidebar-foreground group-data-[collapsible=icon]:hidden"
        >
          {appVersion}
          {changelogUnread && (
            <span
              aria-hidden="true"
              className="absolute top-0 -right-1.5 size-1.5 rounded-full bg-destructive"
            />
          )}
        </Link>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

export function AppLayout() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="h-svh min-w-0 overflow-hidden">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
          <div className="flex-1" />
          <TodoBell />
          <NotificationBell />
        </header>
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto p-4 md:p-6">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
