import { AppLayout } from "@/components/AppLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useAuth } from "@/contexts/AuthContext";
import { NAV_ITEMS, type NavPath, visibleNavItems } from "@/lib/navigation";
import { Forbidden } from "@/pages/Forbidden";
import { Login } from "@/pages/Login";
import { DashboardPage } from "@/pages/dashboard/DashboardPage";
import { RolesPage } from "@/pages/roles/RolesPage";
import { SchedulePage } from "@/pages/schedule/SchedulePage";
import { SlaPage } from "@/pages/sla/SlaPage";
import { TicketDetail } from "@/pages/tickets/TicketDetail";
import { TicketsPage } from "@/pages/tickets/TicketsPage";
import { UsersPage } from "@/pages/users/UsersPage";
import type { ReactElement } from "react";
import { Navigate, Route, Routes } from "react-router";

/**
 * Route tree, kept separate from <App> so tests can mount it in a
 * MemoryRouter. Shell pages are generated from NAV_ITEMS: every menu entry
 * gets a route guarded by the same permission point that controls its menu
 * visibility, so the two can never disagree.
 */

// Record<NavPath, …> makes "menu entry without a page" a compile error.
const PAGES: Record<NavPath, ReactElement> = {
  "/dashboard": <DashboardPage />,
  "/tickets": <TicketsPage />,
  "/users": <UsersPage />,
  "/roles": <RolesPage />,
  "/schedule": <SchedulePage />,
  "/sla": <SlaPage />,
};

/** `/` lands on the first menu page the user may see; no page permissions → 403. */
function IndexRedirect() {
  const { user } = useAuth();
  const first = visibleNavItems(user?.permissions ?? [])[0];
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
        {/* Sub-pages of 工单管理: create needs ticket.create; the detail read
            only ticket.view — data scope is enforced server-side. /tickets/new
            renders 工单管理 with the creation dialog open, so the modal stays
            deep-linkable and guarded like a page. */}
        <Route
          path="/tickets/new"
          element={
            <ProtectedRoute requiredPermission="ticket.create">
              <TicketsPage createOpen />
            </ProtectedRoute>
          }
        />
        <Route
          path="/tickets/:id"
          element={
            <ProtectedRoute requiredPermission="ticket.view">
              <TicketDetail />
            </ProtectedRoute>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
