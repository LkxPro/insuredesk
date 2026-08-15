import { type ReactNode, useEffect, useRef } from "react";
import { DetailNavButtons } from "./DetailNavButtons";
import {
  type DetailNav,
  type DetailNavStep,
  detailNavStep,
  handleDetailArrowKey,
} from "./detail-navigation";

/**
 * 详情 pane 骨架：可聚焦的 section（方向键翻单靠 keydown 冒泡到本区）+ 头部
 * 一行（前导槽 / 工单号 / 状态槽 / 动作槽 / prev-next 翻单按钮 / 尾随槽）。
 * 两个详情区共用：内部 pane 把编辑/分配/完结/删除与「关闭详情」放进动作槽与
 * 尾随槽，外部 pane 把「返回列表」放进前导槽；翻单按钮与键盘契约深模块自带，
 * 换单聚焦（focusKey 变化时焦点回本区）也只维护一份。
 */
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
  /** 方向键与 prev/next 按钮共用的导航面。 */
  nav: DetailNav;
  onStep: (step: DetailNavStep) => void;
  /** 头部最前的槽位（如「返回列表」）。 */
  leading?: ReactNode;
  /** 工单号；undefined 即详情未加载，占位「工单详情」。 */
  title?: string | undefined;
  /** 状态徽标槽。 */
  status?: ReactNode;
  /** 头部动作槽（编辑/分配/完结/删除等），位于翻单按钮之前。 */
  actions?: ReactNode;
  /** 头部末尾的槽位（如「关闭详情」），位于翻单按钮之后。 */
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
