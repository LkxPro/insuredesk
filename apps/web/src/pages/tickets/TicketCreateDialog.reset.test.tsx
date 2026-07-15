import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { httpBatchLink } from "@trpc/client";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";
import { useState } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TicketCreateDialog } from "./TicketCreateDialog";

/**
 * Issue #62 建单默认此刻: each open of 新建工单 rebuilds a fresh form with
 * feedbackTime prefilled to the open instant (打开时刻, minute precision).
 * Reopening refreshes the time and never restores a cancelled draft. The
 * dialog talks to trpc/react-router, so it renders inside a faked-fetch
 * client and a MemoryRouter — no network, no navigation asserted here.
 * useAuth-seam mock as the sibling ticket tests; a null user keeps
 * requiredTicketFields empty, so no field is marked required here.
 */

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: null,
    isLoading: false,
    hasPermission: () => false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

beforeAll(() => {
  Object.assign(window.HTMLElement.prototype, {
    scrollIntoView: vi.fn(),
    hasPointerCapture: vi.fn(() => false),
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
  });
});

function fakeFetch(): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify([{ result: { data: null } }]), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

/** A parent that owns `open` so the test can close and reopen the dialog. */
function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        打开
      </button>
      <TicketCreateDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

function renderHarness() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const trpcClient = trpc.createClient({
    links: [httpBatchLink({ url: "http://localhost/api/trpc", fetch: fakeFetch })],
  });
  return render(
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <Harness />
        </MemoryRouter>
      </QueryClientProvider>
    </trpc.Provider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

/** The date-button label the picker renders for `instant`, in the run's own tz. */
function dateLabel(instant: Date): string {
  return format(instant, "PPP", { locale: zhCN });
}

describe("新建工单 打开即见当前时刻 (issue #62)", () => {
  it("prefills feedbackTime with the open instant, minute precision", async () => {
    const open = new Date("2026-07-15T09:30:00.000Z");
    vi.setSystemTime(open);
    renderHarness();

    fireEvent.click(screen.getByRole("button", { name: "打开" }));
    await screen.findByRole("heading", { name: "新建工单" });

    // A value is present → the clear affordance shows and the date carries 此刻
    expect(screen.getByRole("button", { name: "清空时间" })).toBeInTheDocument();
    expect(screen.getByText(dateLabel(open))).toBeInTheDocument();
  });

  it("reopen refreshes the time to the new 此刻 and drops the previous draft", async () => {
    const firstOpen = new Date("2026-07-15T09:30:00.000Z");
    vi.setSystemTime(firstOpen);
    renderHarness();

    fireEvent.click(screen.getByRole("button", { name: "打开" }));
    await screen.findByRole("heading", { name: "新建工单" });
    expect(screen.getByText(dateLabel(firstOpen))).toBeInTheDocument();

    // Dirty the form, then close without submitting
    fireEvent.change(screen.getByLabelText("客户姓名"), { target: { value: "王小明" } });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "新建工单" })).not.toBeInTheDocument();
    });

    // Time moves on (a whole day, so distinct in any tz); reopening shows the NEW instant
    const secondOpen = new Date("2026-07-16T11:45:00.000Z");
    vi.setSystemTime(secondOpen);
    fireEvent.click(screen.getByRole("button", { name: "打开" }));
    await screen.findByRole("heading", { name: "新建工单" });

    expect(screen.getByText(dateLabel(secondOpen))).toBeInTheDocument();
    expect(screen.queryByText(dateLabel(firstOpen))).not.toBeInTheDocument();
    // The cancelled draft is gone
    expect(screen.getByLabelText("客户姓名")).toHaveValue("");
  });
});
