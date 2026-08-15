import type { ReactNode } from "react";

/**
 * 详情字段栅格原语：内部详情左栏按分区用 DetailSection，外部详情左栏平铺
 * 直接用 DetailGrid；两端单元格同一份样式。
 */

export function DetailGrid({ children }: { children: ReactNode }) {
  return <dl className="m-0 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{children}</dl>;
}

/** 分区标题 + 三列栅格；窄栏自动退回单列。 */
export function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="m-0 text-sm font-medium text-muted-foreground">{title}</h3>
      <DetailGrid>{children}</DetailGrid>
    </section>
  );
}

/** 只读单元格；null/空值统一落到 — （未填写，不是空）。 */
export function DetailItem({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="m-0 text-sm">{children ?? "—"}</dd>
    </div>
  );
}
