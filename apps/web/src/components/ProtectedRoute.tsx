import { FullScreenLoading } from "@/components/FullScreenLoading";
import { useAuth } from "@/contexts/AuthContext";
import type { Permission } from "@insuredesk/shared";
import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";

/**
 * Route guard: renders children only for authenticated users (optionally also
 * requiring a permission point). Unauthenticated visitors are redirected to
 * /login, remembering where they came from so login can send them back.
 */
export function ProtectedRoute({
  children,
  requiredPermission,
}: {
  children: ReactNode;
  requiredPermission?: Permission;
}) {
  const { user, isLoading, hasPermission } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <FullScreenLoading />;
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (requiredPermission && !hasPermission(requiredPermission)) {
    return <Navigate to="/403" replace />;
  }

  return <>{children}</>;
}
