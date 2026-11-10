import "@testing-library/jest-dom/vitest";
import { notifyManager } from "@tanstack/react-query";
import { cleanup, configure } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { flushQueryNotifications, scheduleQueryNotification } from "./query-notifications";

configure({ asyncUtilTimeout: 12000 });

// Query 已排队的通知不会随组件卸载取消，必须在 jsdom 销毁前排空。
notifyManager.setScheduler(scheduleQueryNotification);

afterEach(() => {
  cleanup();
  flushQueryNotifications();
});

// jsdom has no ResizeObserver; Radix (Select trigger sizing) observes with it.
// defineProperty 而非 vi.stubGlobal：renderApp 的 afterEach 调 unstubAllGlobals，
// 会把 stubGlobal 注册的实现连带清掉，后续用例的 Radix Select 就会崩。
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Object.defineProperty(globalThis, "ResizeObserver", {
  writable: true,
  value: ResizeObserverStub,
});

// jsdom has no scrollIntoView; Radix Select 打开时会把选中项滚动进可视区。
Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
  writable: true,
  value: () => {},
});

// jsdom has no matchMedia; ThemeProvider queries it for the initial theme.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});
