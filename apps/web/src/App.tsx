import { ThemeToggle } from "@/components/ThemeToggle";
import { trpc } from "@/lib/trpc";

export function App() {
  // The end-to-end vertical slice: web → TanStack Query → tRPC → Fastify → back.
  const health = trpc.health.useQuery();

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-10">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">InsureDesk</h1>
        <ThemeToggle />
      </header>

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
