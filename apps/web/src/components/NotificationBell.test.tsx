import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { httpBatchLink } from "@trpc/client";
import { MemoryRouter, Route, Routes, useParams } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationBell } from "@/components/NotificationBell";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ToastHost } from "@/components/ToastHost";
import { toastStore } from "@/lib/toast-store";
import { trpc } from "@/lib/trpc";

const auth = vi.hoisted(() => ({ isExternal: false }));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { isExternal: auth.isExternal } }),
}));

type Item = {
  id: string;
  type: string;
  title: string;
  content: string;
  ticketId: string | null;
  workOrderNumber: string | null;
  read: boolean;
  createdAt: string;
};

function item(overrides: Partial<Item> & Pick<Item, "id">): Item {
  return {
    type: "assigned",
    title: "新工单分配",
    content: "李主管 将工单 WO100001 分配给你",
    ticketId: "t1",
    workOrderNumber: "WO100001",
    read: false,
    createdAt: "2026-07-09T08:00:00.000Z",
    ...overrides,
  };
}

const canned = { items: [] as Item[] };
let calls: Array<{ path: string; input: unknown }>;

function respond(path: string, input: unknown): unknown {
  if (path === "notification.list") {
    return {
      items: canned.items,
      unreadCount: canned.items.filter((entry) => !entry.read).length,
    };
  }
  if (path === "notification.markRead") {
    const { id } = input as { id: string };
    canned.items = canned.items.map((entry) =>
      entry.id === id ? { ...entry, read: true } : entry,
    );
    return { ok: true };
  }
  if (path === "notification.markAllRead") {
    canned.items = canned.items.map((entry) => ({ ...entry, read: true }));
    return { ok: true };
  }
  throw new Error(`Unexpected tRPC path: ${path}`);
}

/** Decode batched tRPC calls: GET carries `input` in the URL, POST in the body. */
function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input));
  const paths = (url.pathname.split("/api/trpc/")[1] ?? "").split(",");
  const raw = init?.method === "POST" ? String(init.body) : url.searchParams.get("input");
  const batch = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};

  const body = paths.map((path, index) => {
    const procedureInput = batch[String(index)];
    calls.push({ path, input: procedureInput });
    return { result: { data: respond(path, procedureInput) } };
  });
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

function TicketDetailProbe() {
  const { id } = useParams();
  return <div>工单详情页 {id}</div>;
}

function ExternalTicketDetailProbe() {
  const { id } = useParams();
  return <div>外部工单详情页 {id}</div>;
}

function renderBell() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const trpcClient = trpc.createClient({
    links: [httpBatchLink({ url: "http://localhost/api/trpc", fetch: fakeFetch })],
  });

  const view = render(
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <MemoryRouter initialEntries={["/"]}>
            <Routes>
              <Route path="/" element={<NotificationBell />} />
              <Route path="/tickets/:id" element={<TicketDetailProbe />} />
              <Route path="/external-tickets/:id" element={<ExternalTicketDetailProbe />} />
            </Routes>
          </MemoryRouter>
          <ToastHost />
        </ThemeProvider>
      </QueryClientProvider>
    </trpc.Provider>,
  );
  return { ...view, queryClient };
}

async function poll(queryClient: QueryClient) {
  await act(async () => {
    await queryClient.invalidateQueries();
  });
}

beforeEach(() => {
  canned.items = [];
  calls = [];
  auth.isExternal = false;
  toastStore.clear();
});

describe("badge and inbox", () => {
  it("shows the unread count and lists notifications in the popover", async () => {
    canned.items = [
      item({
        id: "n2",
        title: "工单改派",
        content: "李主管 将工单 WO100002 改派给你（剩余处理时间 3 小时）",
        createdAt: "2026-07-09T09:00:00.000Z",
      }),
      item({ id: "n1", read: true }),
    ];
    renderBell();

    const bell = await screen.findByRole("button", { name: "通知（1 条未读）" });
    expect(bell).toHaveTextContent("1");

    fireEvent.click(bell);
    expect(await screen.findByText("工单改派")).toBeInTheDocument();
    expect(screen.getByText(/改派给你（剩余处理时间 3 小时）/)).toBeInTheDocument();
    expect(screen.getByText("新工单分配")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "全部已读" })).toBeInTheDocument();
  });

  it("shows no badge and an empty state when there is nothing", async () => {
    renderBell();

    const bell = await screen.findByRole("button", { name: "通知" });
    fireEvent.click(bell);
    expect(await screen.findByText("暂无通知")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "全部已读" })).not.toBeInTheDocument();
  });
});

describe("click-through (点击跳详情 + 标已读)", () => {
  it("marks the notification read and navigates to the ticket detail", async () => {
    canned.items = [item({ id: "n1", ticketId: "t1" })];
    renderBell();

    fireEvent.click(await screen.findByRole("button", { name: "通知（1 条未读）" }));
    fireEvent.click(await screen.findByText("新工单分配"));

    await waitFor(() =>
      expect(calls.find((call) => call.path === "notification.markRead")?.input).toEqual({
        id: "n1",
      }),
    );
    expect(await screen.findByText("工单详情页 t1")).toBeInTheDocument();
  });

  it("does not re-mark an already-read notification", async () => {
    canned.items = [item({ id: "n1", read: true })];
    renderBell();

    fireEvent.click(await screen.findByRole("button", { name: "通知" }));
    fireEvent.click(await screen.findByText("新工单分配"));

    expect(await screen.findByText("工单详情页 t1")).toBeInTheDocument();
    expect(calls.some((call) => call.path === "notification.markRead")).toBe(false);
  });

  it("外部账号点击落到 /external-tickets/:id", async () => {
    auth.isExternal = true;
    canned.items = [item({ id: "n1", type: "external_reply", title: "客服跟进", ticketId: "t9" })];
    renderBell();

    fireEvent.click(await screen.findByRole("button", { name: "通知（1 条未读）" }));
    fireEvent.click(await screen.findByText("客服跟进"));

    expect(await screen.findByText("外部工单详情页 t9")).toBeInTheDocument();
    expect(screen.queryByText("工单详情页 t9")).not.toBeInTheDocument();
  });
});

describe("toast on arrival (来了弹 toast)", () => {
  it("toasts only notifications that arrive on a later poll, never the initial backlog", async () => {
    canned.items = [item({ id: "n1" })];
    const { queryClient } = renderBell();

    await screen.findByRole("button", { name: "通知（1 条未读）" });
    expect(screen.queryByText("新工单分配")).not.toBeInTheDocument();

    canned.items = [
      item({
        id: "n2",
        title: "工单改派",
        content: "李主管 将工单 WO100002 改派给你（剩余处理时间 3 小时）",
        ticketId: "t2",
        createdAt: "2026-07-09T09:00:00.000Z",
      }),
      ...canned.items,
    ];
    await poll(queryClient);

    expect(await screen.findByText("工单改派")).toBeInTheDocument();
    expect(screen.queryByText("新工单分配")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("工单改派"));
    await waitFor(() =>
      expect(calls.find((call) => call.path === "notification.markRead")?.input).toEqual({
        id: "n2",
      }),
    );
    expect(await screen.findByText("工单详情页 t2")).toBeInTheDocument();
  });

  it("toasts an unseen notification even when its timestamp predates already-seen ones (commit-order race)", async () => {
    // createdAt is stamped before the assignment transaction commits: a poll
    // can see 09:00 before an 08:30-stamped row lands. Arrival is diffed by
    // id, so the latecomer must still toast.
    canned.items = [item({ id: "n2", createdAt: "2026-07-09T09:00:00.000Z" })];
    const { queryClient } = renderBell();
    await screen.findByRole("button", { name: "通知（1 条未读）" });

    canned.items = [
      ...canned.items,
      item({ id: "n1", title: "工单改派", createdAt: "2026-07-09T08:30:00.000Z" }),
    ];
    await poll(queryClient);

    expect(await screen.findByText("工单改派")).toBeInTheDocument();
  });

  it("collapses a bulk arrival (批量分配) into one summary toast instead of stacking", async () => {
    const { queryClient } = renderBell();
    await screen.findByRole("button", { name: "通知" });

    canned.items = ["n1", "n2", "n3", "n4", "n5"].map((id) => item({ id }));
    await poll(queryClient);

    expect(await screen.findByText("你有 5 条新通知")).toBeInTheDocument();
    expect(screen.queryByText("新工单分配")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("你有 5 条新通知"));
    expect(await screen.findAllByText("新工单分配")).toHaveLength(5);
  });
});

describe("全部已读", () => {
  it("fires markAllRead and clears the badge", async () => {
    canned.items = [item({ id: "n1" }), item({ id: "n2", ticketId: "t2" })];
    renderBell();

    fireEvent.click(await screen.findByRole("button", { name: "通知（2 条未读）" }));
    fireEvent.click(await screen.findByRole("button", { name: "全部已读" }));

    await waitFor(() =>
      expect(calls.some((call) => call.path === "notification.markAllRead")).toBe(true),
    );
    expect(await screen.findByRole("button", { name: "通知" })).toBeInTheDocument();
  });
});
