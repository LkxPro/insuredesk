import type { Permission } from "@insuredesk/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { httpBatchLink } from "@trpc/client";
import { MemoryRouter } from "react-router";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "@/contexts/AuthContext";
import { trpc } from "@/lib/trpc";
import { TEST_ROLES } from "@/test/roles";
import { AppRoutes } from "../../AppRoutes";
import { ThemeProvider } from "../../components/ThemeProvider";

/**
 * 行内快捷操作: hovering a list row surfaces small 分配/完结 buttons that jump
 * straight into AssignTicketDialog / ResolveTicketDialog — without opening
 * the detail dialog the row click leads to. Same faked-fetch tRPC pipeline
 * and useAuth-seam mock as the sibling ticket tests.
 */

const auth = vi.hoisted(() => ({
  user: null as AuthUser | null,
  isLoading: false,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: auth.user,
    isLoading: auth.isLoading,
    hasPermission: (permission: Permission) => auth.user?.permissions.includes(permission) ?? false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

// Radix Select drives its dropdown with pointer-capture and scroll APIs that
// jsdom doesn't implement.
beforeAll(() => {
  Object.assign(window.HTMLElement.prototype, {
    scrollIntoView: vi.fn(),
    hasPointerCapture: vi.fn(() => false),
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
  });
});

function userWith(role: { name: string; permissions: readonly Permission[] }): AuthUser {
  return {
    id: "u1",
    username: "tester",
    name: "测试用户",
    email: null,
    team: null,
    roleId: "r1",
    roleName: role.name,
    permissions: [...role.permissions],
    requiredTicketFields: [],
    isExternal: false,
  };
}

function listItem(
  id: string,
  workOrderNumber: string,
  status: string,
  assignee: { id: string; name: string } | null,
) {
  return {
    id,
    workOrderNumber,
    createdAt: "2026-07-09T02:00:00.000Z",
    source: "manual",
    channel: "保司",
    category: "理赔投诉",
    complaintLevel: "一般投诉",
    customerName: "王小明",
    policyNumbers: ["P2026070900123"],
    status,
    displayStatus: status,
    assigneeId: assignee?.id ?? null,
    assigneeName: assignee?.name ?? null,
    dueAt: "2026-07-11T02:00:00.000Z",
  };
}

/** One row per status: only the two in-flight ones may be 完结'd. */
const LIST_ITEMS = [
  listItem("t1", "WO100001", "unassigned", null),
  listItem("t2", "WO100002", "assigned", { id: "u-zhang", name: "张客服" }),
  listItem("t3", "WO100003", "processing", { id: "u-zhang", name: "张客服" }),
  listItem("t4", "WO100004", "completed", { id: "u-zhang", name: "张客服" }),
];

// A log of every decoded call.
let calls: Array<{ path: string; input: unknown }>;

function respond(path: string, input: unknown): unknown {
  // The AppLayout bell polls notification.list in the same batch
  if (path === "notification.list") {
    return { items: [], unreadCount: 0, todo: { items: [], count: 0 } };
  }
  if (path === "ticket.list") {
    return { items: LIST_ITEMS, total: LIST_ITEMS.length, page: 1, pageSize: 20 };
  }
  if (path === "completionStatus.options") {
    return [{ id: "cs-normal", name: "正常完结" }];
  }
  if (path === "ticket.resolve") {
    const { ticketId } = input as { ticketId: string };
    const row = LIST_ITEMS.find((item) => item.id === ticketId);
    return {
      id: ticketId,
      workOrderNumber: row?.workOrderNumber ?? "",
      completionStatus: "正常完结",
    };
  }
  if (
    path === "channel.filterOptions" ||
    path === "ticketCategory.filterOptions" ||
    path === "completionStatus.filterOptions"
  ) {
    return [];
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

function renderList() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const trpcClient = trpc.createClient({
    links: [httpBatchLink({ url: "http://localhost/api/trpc", fetch: fakeFetch })],
  });

  return render(
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <MemoryRouter initialEntries={["/tickets"]}>
            <AppRoutes />
          </MemoryRouter>
        </ThemeProvider>
      </QueryClientProvider>
    </trpc.Provider>,
  );
}

/** The table row containing the given 工单号. */
function rowFor(workOrderNumber: string) {
  const row = screen
    .getAllByRole("row")
    .find((candidate) => candidate.textContent?.includes(workOrderNumber));
  if (!row) throw new Error(`row not found: ${workOrderNumber}`);
  return row;
}

beforeEach(() => {
  auth.user = userWith(TEST_ROLES.CS_MANAGER);
  auth.isLoading = false;
  calls = [];
});

describe("完结 quick action", () => {
  it("opens ResolveTicketDialog directly — the detail dialog never opens", async () => {
    renderList();
    await screen.findByText("WO100001");

    fireEvent.click(within(rowFor("WO100002")).getByRole("button", { name: "完结" }));

    expect(await screen.findByRole("heading", { name: "完结工单" })).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveTextContent("工单 WO100002");
    // Straight to the resolve dialog: no detail fetch, no detail content
    expect(calls.every((call) => call.path !== "ticket.detail")).toBe(true);
    expect(screen.queryByText("处理记录")).not.toBeInTheDocument();
  });

  it("confirming fires ticket.resolve for that row's ticket", async () => {
    renderList();
    await screen.findByText("WO100001");

    fireEvent.click(within(rowFor("WO100003")).getByRole("button", { name: "完结" }));
    await screen.findByRole("heading", { name: "完结工单" });

    const trigger = await screen.findByRole("combobox", { name: "完结状态" });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerId: 1 });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("option", { name: "正常完结" }));
    fireEvent.change(screen.getByLabelText("完结备注"), { target: { value: "已与客户确认解决" } });
    fireEvent.click(screen.getByRole("button", { name: "确认完结" }));

    await waitFor(() =>
      expect(calls.find((call) => call.path === "ticket.resolve")?.input).toEqual({
        ticketId: "t3",
        completionStatusId: "cs-normal",
        remark: "已与客户确认解决",
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "完结工单" })).not.toBeInTheDocument(),
    );
  });
});
