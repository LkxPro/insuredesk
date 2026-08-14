import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { httpBatchLink } from "@trpc/client";
import { useState } from "react";
import { MemoryRouter } from "react-router";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ToastHost } from "@/components/ToastHost";
import { toast } from "@/lib/toast";
import { trpc } from "@/lib/trpc";
import { TicketCreateDialog } from "./TicketCreateDialog";

/**
 * 关闭逻辑统一: 新建工单 closes on outside click / X / Esc like any
 * dialog, but a dirty form (anything beyond the prefilled feedbackTime
 * default) first asks 丢弃修改？ before discarding the draft. Same faked-fetch
 * client and useAuth-seam mock as the sibling create-dialog tests.
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

/** A parent that owns `open` so the test can observe closes. */
function Harness() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        打开
      </button>
      <TicketCreateDialog open={open} onOpenChange={setOpen} />
      <ToastHost />
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

async function expectDialogClosed() {
  await waitFor(() => {
    expect(screen.queryByRole("heading", { name: "新建工单" })).not.toBeInTheDocument();
  });
}

describe("新建工单 关闭 with a pristine form (仅默认 feedbackTime)", () => {
  it("closes on Esc without asking", async () => {
    renderHarness();
    await screen.findByRole("heading", { name: "新建工单" });

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    await expectDialogClosed();
    expect(screen.queryByText("丢弃修改？")).not.toBeInTheDocument();
  });

  it("closes on the X button without asking", async () => {
    renderHarness();
    await screen.findByRole("heading", { name: "新建工单" });

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await expectDialogClosed();
    expect(screen.queryByText("丢弃修改？")).not.toBeInTheDocument();
  });

  it("closes on an outside click without asking", async () => {
    renderHarness();
    await screen.findByRole("heading", { name: "新建工单" });

    // Radix defers a left-button pointerdown outside until its click lands
    fireEvent.pointerDown(document.body);
    fireEvent.click(document.body);

    await expectDialogClosed();
    expect(screen.queryByText("丢弃修改？")).not.toBeInTheDocument();
  });
});

describe("新建工单 关闭 with an edited form", () => {
  it("Esc asks 丢弃修改？ first; 继续编辑 keeps the dialog and the draft", async () => {
    renderHarness();
    await screen.findByRole("heading", { name: "新建工单" });
    fireEvent.change(screen.getByLabelText("客户姓名"), { target: { value: "王小明" } });

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(await screen.findByText("丢弃修改？")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));

    await waitFor(() => {
      expect(screen.queryByText("丢弃修改？")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { name: "新建工单" })).toBeInTheDocument();
    expect(screen.getByLabelText("客户姓名")).toHaveValue("王小明");
  });

  it("取消 asks too, and 丢弃修改 then closes the dialog", async () => {
    renderHarness();
    await screen.findByRole("heading", { name: "新建工单" });
    fireEvent.change(screen.getByLabelText("客户姓名"), { target: { value: "王小明" } });

    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(await screen.findByText("丢弃修改？")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "丢弃修改" }));

    await expectDialogClosed();
  });

  it("an outside click asks 丢弃修改？ instead of closing", async () => {
    renderHarness();
    await screen.findByRole("heading", { name: "新建工单" });
    fireEvent.change(screen.getByLabelText("客户姓名"), { target: { value: "王小明" } });

    fireEvent.pointerDown(document.body);
    fireEvent.click(document.body);

    expect(await screen.findByText("丢弃修改？")).toBeInTheDocument();
    // The form dialog is still there behind the ask, draft intact
    expect(screen.getByLabelText("客户姓名")).toHaveValue("王小明");
  });

  it("clicking a toast's 关闭键 is not an outside click: no ask, draft intact", async () => {
    renderHarness();
    await screen.findByRole("heading", { name: "新建工单" });
    fireEvent.change(screen.getByLabelText("客户姓名"), { target: { value: "王小明" } });

    toast.error("导出失败", { duration: "sticky" });
    // Radix modal 给 dialog 外的内容挂 aria-hidden，toast 在树外因此 hidden: true
    const closeButton = await screen.findByRole("button", { name: "关闭通知", hidden: true });
    fireEvent.pointerDown(closeButton);
    fireEvent.click(closeButton);

    // toast 正常关闭，但表单 dialog 不问也不关
    expect(screen.queryByText("导出失败")).not.toBeInTheDocument();
    expect(screen.queryByText("丢弃修改？")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "新建工单" })).toBeInTheDocument();
    expect(screen.getByLabelText("客户姓名")).toHaveValue("王小明");
  });

  it("clearing the prefilled feedbackTime counts as a change", async () => {
    renderHarness();
    await screen.findByRole("heading", { name: "新建工单" });
    fireEvent.click(screen.getByRole("button", { name: "清空时间" }));

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(await screen.findByText("丢弃修改？")).toBeInTheDocument();
  });

  it("typing then erasing back to the defaults closes without asking", async () => {
    renderHarness();
    await screen.findByRole("heading", { name: "新建工单" });
    const name = screen.getByLabelText("客户姓名");
    fireEvent.change(name, { target: { value: "王小明" } });
    fireEvent.change(name, { target: { value: "" } });

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    await expectDialogClosed();
    expect(screen.queryByText("丢弃修改？")).not.toBeInTheDocument();
  });
});
