import type { KeyboardEvent } from "react";

/**
 * 主从单页共用的翻单契约：neighbors 派生（详情在当前页切片里的前后单）与
 * ↑/↓ 键处理。内部 /tickets 与外部 /external-tickets 两处主从共用——交互
 * 契约（输入控件内的方向键归控件自己、边缘不翻页）只在这里维护一份。
 */

/** 边缘 stop dead——不翻页；深链进来的单不在切片里则无邻居。 */
export function detailNeighbors<T extends { id: string }>(
  items: readonly T[],
  selectedId: string | undefined,
): { prev: string | null; next: string | null } {
  const index = selectedId === undefined ? -1 : items.findIndex((t) => t.id === selectedId);
  return {
    prev: index > 0 ? (items[index - 1]?.id ?? null) : null,
    next: index === -1 ? null : (items[index + 1]?.id ?? null),
  };
}

export function handleDetailArrowKey(
  event: KeyboardEvent<HTMLElement>,
  neighbors: { prev: string | null; next: string | null },
  onSwitch: (ticketId: string) => void,
): void {
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
  // 输入控件内的方向键归控件自己（光标移动、Select 选项浏览）
  const target = event.target as HTMLElement;
  if (target.closest("input, textarea, [role='combobox'], [role='listbox']")) return;
  const to = event.key === "ArrowUp" ? neighbors.prev : neighbors.next;
  if (!to) return;
  event.preventDefault();
  onSwitch(to);
}
