import { Spinner } from "@/components/ui/spinner";

export function FullScreenLoading() {
  return (
    <main className="flex min-h-svh items-center justify-center gap-2 text-muted-foreground">
      <Spinner />
      <span className="text-sm">加载中…</span>
    </main>
  );
}
