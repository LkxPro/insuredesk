import { type ReactNode, useEffect, useRef } from "react";
import { DetailNavButtons } from "./DetailNavButtons";
import {
  type DetailNav,
  type DetailNavStep,
  detailNavStep,
  handleDetailArrowKey,
} from "./detail-navigation";

export function DetailPaneShell({
  focusKey,
  nav,
  onStep,
  leading,
  title,
  status,
  actions,
  trailing,
  children,
}: {
  /** 换单信号：变化时焦点回本区。 */
  focusKey: string;
  nav: DetailNav;
  onStep: (step: DetailNavStep) => void;
  leading?: ReactNode;
  /** 工单号；undefined 即详情未加载，占位「工单详情」。 */
  title?: string | undefined;
  status?: ReactNode;
  actions?: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  const paneRef = useRef<HTMLElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: focusKey 是触发聚焦的信号，不在 effect 体内使用
  useEffect(() => {
    paneRef.current?.focus({ preventScroll: true });
  }, [focusKey]);

  return (
    <section
      ref={paneRef}
      aria-label="工单详情"
      className="flex min-h-0 flex-1 flex-col outline-hidden"
      tabIndex={-1}
      onKeyDown={(event) => handleDetailArrowKey(event, nav, onStep)}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-3">
        {leading}
        <h2 className="m-0 text-lg font-semibold tracking-tight">{title ?? "工单详情"}</h2>
        {status}
        <div className="flex-1" />
        {actions}
        <DetailNavButtons
          prevStep={detailNavStep("prev", nav)}
          nextStep={detailNavStep("next", nav)}
          onStep={onStep}
        />
        {trailing}
      </div>
      {children}
    </section>
  );
}
