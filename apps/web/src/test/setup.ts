import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach, vi } from "vitest";

configure({ asyncUtilTimeout: 12000 });

// RTL only auto-cleans with vitest globals enabled; we import hooks explicitly.
afterEach(() => {
  cleanup();
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
