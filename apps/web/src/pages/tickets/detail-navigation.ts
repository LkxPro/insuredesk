import type { KeyboardEvent } from "react";
import { useEffect, useState } from "react";
import { useLocation } from "react-router";

/**
 * 主从单页共用的翻单契约：切片位置派生（详情在当前页切片里的前后单）、页
 * 边界判定、↑/↓/←/→ 键处理与越界翻页。内部 /tickets 与外部 /external-tickets
 * 两处主从共用——交互契约（输入控件内的方向键归控件自己、越界翻页、边缘与
 * 不在切片里死停）只在这里维护一份。URL 页码是唯一翻页状态源：越界 = 改
 * ?page= + 落地选中边界单，详情导航因此直接驱动列表页码，不另维护游标。
 */

export type CrossPageDirection = "prev" | "next";

/** 翻单全貌：切片内前后单、选中单是否在切片里、两个方向还有没有页可翻。 */
export type DetailNav = {
  prev: string | null;
  next: string | null;
  inSlice: boolean;
  hasPrevPage: boolean;
  hasNextPage: boolean;
};

/** 翻单一步的落点：切片内换单，或越界翻页（新页数据到了再选边界单）。 */
export type DetailNavStep =
  | { kind: "switch"; ticketId: string }
  | { kind: "crossPage"; direction: CrossPageDirection };

/** 两个方向还有没有页可翻；page*pageSize 恰好等于 total 即已到末页。 */
export function pageBounds({
  page,
  pageSize,
  total,
}: {
  page: number;
  pageSize: number;
  total: number;
}): { hasPrevPage: boolean; hasNextPage: boolean } {
  return { hasPrevPage: page > 1, hasNextPage: page * pageSize < total };
}

/** 选中单在当前页切片里的位置 + 页边界，合成翻单面。 */
export function detailNav<T extends { id: string }>(
  items: readonly T[],
  selectedId: string | undefined,
  paging: { page: number; pageSize: number; total: number },
): DetailNav {
  const index = selectedId === undefined ? -1 : items.findIndex((t) => t.id === selectedId);
  return {
    prev: index > 0 ? (items[index - 1]?.id ?? null) : null,
    next: index === -1 ? null : (items[index + 1]?.id ?? null),
    inSlice: index !== -1,
    ...pageBounds(paging),
  };
}

/**
 * 方向 → 一步的落点：邻居优先，越界翻页次之，都没有则死停（null）。
 * 越界翻页的前提是选中单真的是切片边界——深链进来的单不在切片里时
 * 无邻居也无页可翻，方向键与按钮都死停。
 */
export function detailNavStep(direction: CrossPageDirection, nav: DetailNav): DetailNavStep | null {
  const neighbor = direction === "prev" ? nav.prev : nav.next;
  if (neighbor) return { kind: "switch", ticketId: neighbor };
  const canCross = nav.inSlice && (direction === "prev" ? nav.hasPrevPage : nav.hasNextPage);
  return canCross ? { kind: "crossPage", direction } : null;
}

const DIRECTION_BY_KEY: Record<string, CrossPageDirection> = {
  ArrowUp: "prev",
  ArrowLeft: "prev",
  ArrowDown: "next",
  ArrowRight: "next",
};

export function handleDetailArrowKey(
  event: KeyboardEvent<HTMLElement>,
  nav: DetailNav,
  onStep: (step: DetailNavStep) => void,
): void {
  const direction = DIRECTION_BY_KEY[event.key];
  if (!direction) return;
  // 输入控件内的方向键归控件自己（光标移动、Select 选项浏览）
  const target = event.target as HTMLElement;
  if (target.closest("input, textarea, [role='combobox'], [role='listbox']")) return;
  const step = detailNavStep(direction, nav);
  if (!step) return;
  event.preventDefault();
  onStep(step);
}

/**
 * 越界翻页：改 URL 页码（setPage 由页面注入，带「筛选变更回第 1 页」的
 * 写入器），等新页数据真正到达后选中边界单——next 选新页第一条，prev 选
 * 最后一条。placeholder 期间 items 还是旧页切片，不能选。
 *
 * 落地请求与路由跳转分两拍提交（本地 setState 先到、location 后到），所以
 * 以「URL 真的离开了请求时的 search」作翻页已发生的判据；URL 动了但页码
 * 不是目标页，说明筛选变更/手动跳页插了队，请求作废不落地。
 */
export function useCrossPageNav({
  items,
  page,
  isPlaceholderData,
  select,
  setPage,
}: {
  items: readonly { id: string }[];
  page: number;
  isPlaceholderData: boolean;
  select: (ticketId: string) => void;
  setPage: (page: number) => void;
}): (direction: CrossPageDirection) => void {
  const { search } = useLocation();
  const [landing, setLanding] = useState<{
    direction: CrossPageDirection;
    targetPage: number;
    fromSearch: string;
  } | null>(null);

  useEffect(() => {
    if (landing === null || isPlaceholderData) return;
    if (search === landing.fromSearch) return; // setPage 的 URL 变更还没落到路由
    if (page !== landing.targetPage) {
      setLanding(null);
      return;
    }
    setLanding(null);
    const target = landing.direction === "next" ? items[0] : items[items.length - 1];
    if (target) select(target.id);
  }, [landing, isPlaceholderData, search, page, items, select]);

  return (direction) => {
    const targetPage = direction === "next" ? page + 1 : page - 1;
    setLanding({ direction, targetPage, fromSearch: search });
    setPage(targetPage);
  };
}
