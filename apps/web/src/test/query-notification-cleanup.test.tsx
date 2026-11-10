import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { flushQueryNotifications, scheduleQueryNotification } from "./query-notifications";

it("卸载后排空查询通知，不向已销毁的测试环境遗留定时器", async () => {
  const client = new QueryClient();
  const key = ["notification-cleanup"];
  client.setQueryData(key, "before");

  function Value() {
    const query = useQuery({ queryKey: key, queryFn: () => "before", enabled: false });
    return <span>{String(query.data)}</span>;
  }

  render(
    <QueryClientProvider client={client}>
      <Value />
    </QueryClientProvider>,
  );
  expect(screen.getByText("before")).toBeInTheDocument();

  vi.useFakeTimers();
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  if (!windowDescriptor) throw new Error("缺少 jsdom window");
  try {
    await act(async () => {
      client.setQueryData(key, "after");
    });
    cleanup();
    client.clear();
    flushQueryNotifications();
    Reflect.deleteProperty(globalThis, "window");
    await vi.runOnlyPendingTimersAsync();
  } finally {
    Object.defineProperty(globalThis, "window", windowDescriptor);
    cleanup();
    client.clear();
    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();
  }
});

it("正常定时执行的通知不会在清理时重复执行", async () => {
  vi.useFakeTimers();
  try {
    const notified = vi.fn();
    scheduleQueryNotification(notified);
    expect(notified).not.toHaveBeenCalled();
    await vi.runOnlyPendingTimersAsync();
    expect(notified).toHaveBeenCalledTimes(1);
    flushQueryNotifications();
    expect(notified).toHaveBeenCalledTimes(1);
  } finally {
    flushQueryNotifications();
    vi.useRealTimers();
  }
});

it("清理时执行嵌套通知并保留回调错误", () => {
  const nested = vi.fn();
  scheduleQueryNotification(() => scheduleQueryNotification(nested));
  flushQueryNotifications();
  expect(nested).toHaveBeenCalledTimes(1);

  scheduleQueryNotification(() => {
    throw new Error("notification failed");
  });
  expect(flushQueryNotifications).toThrow("notification failed");
});
