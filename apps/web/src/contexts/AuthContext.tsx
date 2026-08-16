import type { AppRouter } from "@insuredesk/api";
import type { Permission } from "@insuredesk/shared";
import type { inferRouterOutputs } from "@trpc/server";
import { createContext, type ReactNode, useCallback, useContext, useMemo } from "react";
import { trpc } from "@/lib/trpc";

/**
 * Global authentication state, driven by the `auth.me` query. The session
 * itself lives in an httpOnly cookie the JS never sees — `me` succeeding is
 * the only signal that we're logged in.
 *
 * Login/logout go through the REST endpoints (POST /api/auth/{login,logout})
 * because they set/clear that cookie, then re-sync the `me` cache.
 */

export type AuthUser = inferRouterOutputs<AppRouter>["auth"]["me"];

export type LoginResult = { ok: true } | { ok: false; error: string };

interface AuthContextValue {
  /** Authenticated user, or null when logged out (or session expired). */
  user: AuthUser | null;
  /** True while the initial `me` query is still deciding who we are. */
  isLoading: boolean;
  hasPermission: (permission: Permission) => boolean;
  login: (username: string, password: string) => Promise<LoginResult>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const utils = trpc.useUtils();
  // `me` throws UNAUTHORIZED when logged out — that's the expected "no user"
  // signal, so don't retry it.
  const me = trpc.auth.me.useQuery(undefined, { retry: false });

  const user = me.data ?? null;

  const login = useCallback(
    async (username: string, password: string): Promise<LoginResult> => {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        return { ok: false, error: body?.error ?? `登录失败（${res.status}）` };
      }

      // Cookie is set — refetch identity so every consumer sees the new user.
      await utils.auth.me.invalidate();
      return { ok: true };
    },
    [utils],
  );

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    // reset (not invalidate): a failing refetch keeps stale data around,
    // reset drops the cached identity immediately.
    await utils.auth.me.reset();
  }, [utils]);

  const value: AuthContextValue = useMemo(
    () => ({
      user,
      isLoading: me.isLoading,
      hasPermission: (permission) => user?.permissions.includes(permission) ?? false,
      login,
      logout,
    }),
    [user, me.isLoading, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within <AuthProvider>");
  }
  return ctx;
}
