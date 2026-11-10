const pending = new Map<ReturnType<typeof setTimeout>, () => void>();

export function scheduleQueryNotification(callback: () => void): void {
  const timer = setTimeout(() => {
    pending.delete(timer);
    callback();
  }, 0);
  pending.set(timer, callback);
}

export function flushQueryNotifications(): void {
  while (pending.size > 0) {
    for (const [timer, callback] of pending) {
      clearTimeout(timer);
      pending.delete(timer);
      callback();
    }
  }
}
