import { type ToastKind, type ToastOptions, toastStore } from "@/lib/toast-store";

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
