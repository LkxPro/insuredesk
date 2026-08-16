import { lazy, type ReactElement, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router";
import { AppLayout } from "@/components/AppLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/contexts/AuthContext";
import { NAV_ITEMS, type NavPath, visibleNavItems } from "@/lib/navigation";
import { Forbidden } from "@/pages/Forbidden";
import { Login } from "@/pages/Login";

/**
 * Route tree, kept separate from <App> so tests can mount it in a
 * MemoryRouter. Shell pages are generated from NAV_ITEMS: every menu entry
 * gets a route guarded by the same permission point that controls its menu
 * visibility, so the two can never disagree.
 */

// Pages load on demand: eager imports would fold every page into the initial
// chunk and its module evaluation alone exceeds 50ms on first paint.
const DashboardPage = lazy(() =>
  import("@/pages/dashboard/DashboardPage").then((m) => ({ default: m.DashboardPage })),
);
const DictionaryPage = lazy(() =>
  import("@/pages/dictionary/DictionaryPage").then((m) => ({ default: m.DictionaryPage })),
);
const ExternalAccountManagePage = lazy(() =>
  import("@/pages/external-accounts/ExternalAccountManagePage").then((m) => ({
    default: m.ExternalAccountManagePage,
  })),
);
const ExternalTicketsPage = lazy(() =>
  import("@/pages/external-tickets/ExternalTicketsPage").then((m) => ({
    default: m.ExternalTicketsPage,
  })),
);
const ProfilePage = lazy(() =>
  import("@/pages/profile/ProfilePage").then((m) => ({ default: m.ProfilePage })),
);
const RolesPage = lazy(() =>
  import("@/pages/roles/RolesPage").then((m) => ({ default: m.RolesPage })),
);
const SchedulePage = lazy(() =>
  import("@/pages/schedule/SchedulePage").then((m) => ({ default: m.SchedulePage })),
);
const ShiftTypesPage = lazy(() =>
  import("@/pages/shift-types/ShiftTypesPage").then((m) => ({ default: m.ShiftTypesPage })),
);
const SlaPage = lazy(() => import("@/pages/sla/SlaPage").then((m) => ({ default: m.SlaPage })));
const TicketsPage = lazy(() =>
  import("@/pages/tickets/TicketsPage").then((m) => ({ default: m.TicketsPage })),
);
const UsersPage = lazy(() =>
  import("@/pages/users/UsersPage").then((m) => ({ default: m.UsersPage })),
);

function PageFallback() {
  return (
    <div className="flex min-h-40 items-center justify-center gap-2 text-muted-foreground">
      <Spinner />
      <span className="text-sm">加载中…</span>
    </div>
  );
}

/** Suspense sits inside the layout+guard so a loading chunk never unmounts the shell. */
function suspense(el: ReactElement) {
  return <Suspense fallback={<PageFallback />}>{el}</Suspense>;
}

// Record<NavPath, …> makes "menu entry without a page" a compile error.
const PAGES: Record<NavPath, ReactElement> = {
  "/dashboard": suspense(<DashboardPage />),
  "/external-tickets": suspense(<ExternalTicketsPage />),
  "/tickets": suspense(<TicketsPage />),
  "/users": suspense(<UsersPage />),
  "/external-accounts": suspense(<ExternalAccountManagePage />),
  "/roles": suspense(<RolesPage />),
  "/schedule": suspense(<SchedulePage />),
  "/shift-types": suspense(<ShiftTypesPage />),
  "/sla": suspense(<SlaPage />),
  "/dictionary": suspense(<DictionaryPage />),
};

/** `/` lands on the first menu page the user may see; no page permissions → 403. */
function IndexRedirect() {
  const { user } = useAuth();
  const first = visibleNavItems(user?.permissions ?? [], user?.isExternal ?? false)[0];
  return <Navigate to={first?.path ?? "/403"} replace />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/403" element={<Forbidden />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<IndexRedirect />} />
        {/* 个人资料: entered from the header user menu, not the sidebar —
            login is the only guard, so it takes no permission point. */}
        <Route path="/profile" element={suspense(<ProfilePage />)} />
        {NAV_ITEMS.map((item) => (
          <Route
            key={item.path}
            path={item.path}
            element={
              <ProtectedRoute requiredPermission={item.permission}>
                {PAGES[item.path]}
              </ProtectedRoute>
            }
          />
        ))}
        {/* Sub-pages of 工单管理 are route-driven dialogs over the list, so
            they stay deep-linkable and guarded like pages: create needs
            ticket.create; the detail read only ticket.view — data scope is
            enforced server-side. */}
        <Route
          path="/tickets/new"
          element={
            <ProtectedRoute requiredPermission="ticket.create">
              {suspense(<TicketsPage createOpen />)}
            </ProtectedRoute>
          }
        />
        <Route
          path="/tickets/:id"
          element={
            <ProtectedRoute requiredPermission="ticket.view">
              {suspense(<TicketsPage />)}
            </ProtectedRoute>
          }
        />
        {/* 外部端：/external-tickets 是列表，:id 是整页详情，与 /tickets/:id
            同一处理。守卫与列表同一个权限点，数据范围在服务端。 */}
        <Route
          path="/external-tickets/:id"
          element={
            <ProtectedRoute requiredPermission="ticket.create_external">
              {suspense(<ExternalTicketsPage />)}
            </ProtectedRoute>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
