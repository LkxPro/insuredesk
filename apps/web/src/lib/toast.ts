import { type ToastKind, type ToastOptions, toastStore } from "@/lib/toast-store";

/**
 * 轻提示入口，API 形状与 sonner 的 toast 对齐（调用点只换 import）。
 * 渲染由 ToastHost 负责：顶部居中、不自动消失、带关闭键。
 */

function push(kind: ToastKind) {
  return (message: string, options?: ToastOptions) =>
    toastStore.push({ kind, message, ...options });
}

export const toast = Object.assign(
  (message: string, options?: ToastOptions) =>
    toastStore.push({ kind: "info", message, ...options }),
  {
    success: push("success"),
    error: push("error"),
    warning: push("warning"),
    info: push("info"),
  },
);
