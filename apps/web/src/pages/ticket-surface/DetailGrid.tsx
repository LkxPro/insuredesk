import type { ReactNode } from "react";

export function DetailGrid({ children }: { children: ReactNode }) {
  return <dl className="m-0 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{children}</dl>;
}

export function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="m-0 text-sm font-medium text-muted-foreground">{title}</h3>
      <DetailGrid>{children}</DetailGrid>
    </section>
  );
}

export function DetailItem({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="m-0 text-sm">{children ?? "—"}</dd>
    </div>
  );
}
