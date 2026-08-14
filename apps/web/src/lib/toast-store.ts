/**
 * 轻提示 store：顶部居中、不自动消失的胶囊队列（ToastHost 渲染）。
 * Framework-free so the imperative `toast` facade stays mockable in tests
 * without touching the rendered host. Sticky by design — items leave only via
 * 关闭键 or click-through; the queue caps at MAX_ITEMS (oldest dropped) so a
 * burst can't bury the screen.
 */

export type ToastKind = "success" | "error" | "warning" | "info";

export type ToastOptions = {
  description?: string;
  /** 点击通知本体触发（如跳转对应页面），触发后该条随之关闭。 */
  onClick?: () => void;
};

export type ToastItem = ToastOptions & {
  id: number;
  kind: ToastKind;
  message: string;
};

const MAX_ITEMS = 6;

let items: ToastItem[] = [];
let nextId = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

export const toastStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getItems: () => items,
  push(item: Omit<ToastItem, "id">) {
    nextId += 1;
    items = [...items, { ...item, id: nextId }].slice(-MAX_ITEMS);
    emit();
  },
  dismiss(id: number) {
    items = items.filter((item) => item.id !== id);
    emit();
  },
  clear() {
    items = [];
    emit();
  },
};
