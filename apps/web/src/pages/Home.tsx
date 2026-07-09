import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { trpc } from "@/lib/trpc";
import { useNavigate } from "react-router";

export function Home() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  // The end-to-end vertical slice: web → TanStack Query → tRPC → Fastify → back.
  const health = trpc.health.useQuery();

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-10">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">InsureDesk</h1>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button variant="outline" size="sm" onClick={handleLogout}>
            退出登录
          </Button>
        </div>
      </header>

      {user && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">当前用户</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-lg font-medium">
              {user.name}
              <span className="ml-2 text-sm text-muted-foreground">
                @{user.username} · {user.roleName}
              </span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {user.permissions.map((permission) => (
                <span
                  key={permission}
                  className="rounded-md bg-secondary px-2 py-0.5 text-xs text-secondary-foreground"
                >
                  {permission}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <section className="rounded-lg border border-border bg-card p-6 text-card-foreground">
        <h2 className="text-sm font-medium text-muted-foreground">API health</h2>

        {health.isPending && <p className="mt-2 text-sm">Checking API…</p>}

        {health.isError && (
          <p className="mt-2 text-sm text-destructive">
            Failed to reach API: {health.error.message}
          </p>
        )}

        {health.data && (
          <div className="mt-2 space-y-1">
            <p className="text-lg font-medium">
              <span className="text-success">●</span> {health.data.status}
            </p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <dt>service</dt>
              <dd className="text-foreground">{health.data.service}</dd>
              <dt>uptime</dt>
              <dd className="text-foreground">{health.data.uptimeSeconds.toFixed(1)}s</dd>
              <dt>timestamp</dt>
              <dd className="text-foreground">{health.data.timestamp}</dd>
            </dl>
          </div>
        )}
      </section>
    </main>
  );
}
