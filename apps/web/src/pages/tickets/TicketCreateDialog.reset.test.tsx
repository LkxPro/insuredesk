import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { httpBatchLink } from "@trpc/client";
import { format } from "date-fns";
import { useState } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { trpc } from "@/lib/trpc";
import { TicketCreateDialog } from "./TicketCreateDialog";

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

/** The keyboard-editable date value the picker renders in the run's own tz. */
function dateValue(instant: Date): string {
  return format(instant, "yy-MM-dd");
}

describe("新建工单 打开即见当前时刻 (issue #62)", () => {
  it("prefills feedbackTime with the open instant, minute precision", async () => {
    const open = new Date("2026-07-15T09:30:00.000Z");
    vi.setSystemTime(open);
    renderHarness();

    fireEvent.click(screen.getByRole("button", { name: "打开" }));
    await screen.findByRole("heading", { name: "新建工单" });

    expect(screen.getByRole("button", { name: "清空时间" })).toBeInTheDocument();
    expect(screen.getByLabelText("反馈时间")).toHaveValue(dateValue(open));
  });

  it("reopen refreshes the time to the new 此刻 and drops the previous draft", async () => {
    const firstOpen = new Date("2026-07-15T09:30:00.000Z");
    vi.setSystemTime(firstOpen);
    renderHarness();

    fireEvent.click(screen.getByRole("button", { name: "打开" }));
    await screen.findByRole("heading", { name: "新建工单" });
    expect(screen.getByLabelText("反馈时间")).toHaveValue(dateValue(firstOpen));

    fireEvent.change(screen.getByLabelText("客户姓名"), { target: { value: "王小明" } });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    fireEvent.click(await screen.findByRole("button", { name: "丢弃修改" }));
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "新建工单" })).not.toBeInTheDocument();
    });

    const secondOpen = new Date("2026-07-16T11:45:00.000Z");
    vi.setSystemTime(secondOpen);
    fireEvent.click(screen.getByRole("button", { name: "打开" }));
    await screen.findByRole("heading", { name: "新建工单" });

    expect(screen.getByLabelText("反馈时间")).toHaveValue(dateValue(secondOpen));
    expect(screen.getByLabelText("客户姓名")).toHaveValue("");
  });
});
