export type ToastKind = "success" | "error" | "warning" | "info";

export type ToastOptions = {
  description?: string;
  onClick?: () => void;
  duration?: number | "sticky";
};

export type ToastItem = ToastOptions & {
  id: number;
  kind: ToastKind;
  message: string;
};

const MAX_ITEMS = 6;
const DEFAULT_DURATION = 4_000;

/** ToastHost 根节点标记，modal 组件据此豁免界外点击。 */
export const TOAST_HOST_SELECTOR = '[data-slot="toast-host"]';

export function isFromToastHost(event: { target: EventTarget | null }): boolean {
  return event.target instanceof Element && event.target.closest(TOAST_HOST_SELECTOR) !== null;
}

let items: ToastItem[] = [];
let nextId = 0;
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function clearTimer(id: number) {
  const timer = timers.get(id);
  if (timer !== undefined) {
    clearTimeout(timer);
    timers.delete(id);
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
    const id = nextId;
    const kept = [...items, { ...item, id }];
    for (const dropped of kept.slice(0, Math.max(0, kept.length - MAX_ITEMS))) {
      clearTimer(dropped.id);
    }
    items = kept.slice(-MAX_ITEMS);
    const duration = item.duration ?? DEFAULT_DURATION;
    if (duration !== "sticky") {
      timers.set(
        id,
        setTimeout(() => toastStore.dismiss(id), duration),
      );
    }
    emit();
  },
  dismiss(id: number) {
    clearTimer(id);
    items = items.filter((item) => item.id !== id);
    emit();
  },
  clear() {
    for (const id of timers.keys()) {
      clearTimer(id);
    }
    items = [];
    emit();
  },
};
