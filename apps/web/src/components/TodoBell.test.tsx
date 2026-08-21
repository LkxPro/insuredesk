import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { httpBatchLink } from "@trpc/client";
import { MemoryRouter, Route, Routes, useParams } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { ThemeProvider } from "@/components/ThemeProvider";
import { TodoBell } from "@/components/TodoBell";
import { trpc } from "@/lib/trpc";

type TodoAlert = {
  type:
    | "awaiting_first_response"
    | "follow_up_checkpoint"
    | "rolling_follow_up"
    | "due_soon"
    | "overdue";
  severity: "warning" | "critical";
  message: string;
};

type TodoItem = {
  ticketId: string;
  workOrderNumber: string;
  customerName: string;
  slaPolicyName: string | null;
  createdAt: string;
  dueAt: string | null;
  severity: "warning" | "critical";
  alerts: TodoAlert[];
};

function todoItem(overrides: Partial<TodoItem> & Pick<TodoItem, "ticketId">): TodoItem {
  return {
    workOrderNumber: "WO100001",
    customerName: "赵待办",
    slaPolicyName: "一般投诉",
    createdAt: "2026-07-09T08:00:00.000Z",
    dueAt: "2026-07-11T08:00:00.000Z",
    severity: "warning",
    alerts: [
      {
        type: "awaiting_first_response",
        severity: "warning",
        message: "尚未首次跟进，已等待 30 分钟",
      },
    ],
    ...overrides,
  };
}

const canned = { todoItems: [] as TodoItem[] };

function respond(path: string): unknown {
  if (path === "notification.list") {
    return {
      items: [],
      unreadCount: 0,
      todo: { items: canned.todoItems, count: canned.todoItems.length },
    };
  }
  throw new Error(`Unexpected tRPC path: ${path}`);
}

/** Decode batched tRPC calls: GET carries `input` in the URL, POST in the body. */
function fakeFetch(input: RequestInfo | URL): Promise<Response> {
  const url = new URL(String(input));
  const paths = (url.pathname.split("/api/trpc/")[1] ?? "").split(",");
  const body = paths.map((path) => ({ result: { data: respond(path) } }));
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

function renderTodoBell() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const trpcClient = trpc.createClient({
    links: [httpBatchLink({ url: "http://localhost/api/trpc", fetch: fakeFetch })],
  });

  return render(
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <MemoryRouter initialEntries={["/"]}>
            <Routes>
              <Route path="/" element={<TodoBell />} />
              <Route path="/tickets/:id" element={<TicketDetailProbe />} />
            </Routes>
          </MemoryRouter>
        </ThemeProvider>
      </QueryClientProvider>
    </trpc.Provider>,
  );
}

beforeEach(() => {
  canned.todoItems = [];
});

describe("red-dot badge and list", () => {
  it("shows the ticket count and lists每张工单的告警 with severity chips", async () => {
    canned.todoItems = [
      todoItem({
        ticketId: "t1",
        severity: "critical",
        alerts: [
          {
            type: "awaiting_first_response",
            severity: "critical",
            message: "尚未首次跟进，已等待 3 小时",
          },
          {
            type: "follow_up_checkpoint",
            severity: "warning",
            message: "24 小时检查点将至：已跟进 0/1 次",
          },
        ],
      }),
      todoItem({
        ticketId: "t2",
        workOrderNumber: "WO100002",
        customerName: "特急客户",
        slaPolicyName: "特急投诉",
        dueAt: null,
        severity: "critical",
        alerts: [
          {
            type: "rolling_follow_up",
            severity: "critical",
            message: "距上次跟进已 13 小时，要求每 12 小时跟进",
          },
        ],
      }),
    ];
    renderTodoBell();

    const bell = await screen.findByRole("button", { name: "我的待办（2 项）" });
    expect(bell).toHaveTextContent("2");

    fireEvent.click(bell);
    expect(await screen.findByText("WO100001")).toBeInTheDocument();
    expect(screen.getByText("待首响")).toBeInTheDocument();
    expect(screen.getByText("跟进检查点")).toBeInTheDocument();
    expect(screen.getByText("尚未首次跟进，已等待 3 小时")).toBeInTheDocument();
    expect(screen.getByText("WO100002")).toBeInTheDocument();
    expect(screen.getByText("滚动跟进")).toBeInTheDocument();
    expect(screen.getByText("一般投诉")).toBeInTheDocument();
    expect(screen.getByText("特急投诉")).toBeInTheDocument();

    const critical = screen.getByText("尚未首次跟进，已等待 3 小时").closest("[data-severity]");
    expect(critical).toHaveAttribute("data-severity", "critical");
    const warning = screen.getByText("24 小时检查点将至：已跟进 0/1 次").closest("[data-severity]");
    expect(warning).toHaveAttribute("data-severity", "warning");
  });

  it("shows no badge and an empty state when nothing needs attention", async () => {
    renderTodoBell();

    const bell = await screen.findByRole("button", { name: "我的待办" });
    fireEvent.click(bell);
    expect(await screen.findByText("暂无待办")).toBeInTheDocument();
  });
});

describe("click-through (点击跳详情)", () => {
  it("navigates to the ticket detail — nothing to mark read on a computed alert", async () => {
    canned.todoItems = [todoItem({ ticketId: "t9" })];
    renderTodoBell();

    fireEvent.click(await screen.findByRole("button", { name: "我的待办（1 项）" }));
    fireEvent.click(await screen.findByText("WO100001"));

    expect(await screen.findByText("工单详情页 t9")).toBeInTheDocument();
  });
});
