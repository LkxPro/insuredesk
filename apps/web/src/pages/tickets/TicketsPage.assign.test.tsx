import type { Permission } from "@insuredesk/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { httpBatchLink } from "@trpc/client";
import { MemoryRouter } from "react-router";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "@/contexts/AuthContext";
import { trpc } from "@/lib/trpc";
import { TEST_ROLES } from "@/test/roles";
import { AppRoutes } from "../../AppRoutes";
import { ThemeProvider } from "../../components/ThemeProvider";

/**
 * Assignment flows: the dialog carries the "时限不顺延" hint on reassignment,
 * and confirming fires the right mutation with the right payload. Same
 * faked-fetch tRPC pipeline and useAuth-seam mock as TicketsPage.list.test.tsx.
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

type ListItem = {
  id: string;
  workOrderNumber: string;
  createdAt: string;
  source: string;
  channel: string;
  category: string;
  complaintLevel: string;
  customerName: string;
  policyNumbers: string[];
  status: string;
  displayStatus: string;
  assigneeId: string | null;
  assigneeName: string | null;
  dueAt: string | null;
};

function listItem(overrides: Partial<ListItem> = {}): ListItem {
  return {
    id: "t1",
    workOrderNumber: "WO100001",
    createdAt: "2026-07-09T02:00:00.000Z",
    source: "manual",
    channel: "保司",
    category: "投诉-保费收取问题",
    complaintLevel: "一般投诉",
    customerName: "王小明",
    policyNumbers: ["P2026070900123"],
    status: "unassigned",
    displayStatus: "unassigned",
    assigneeId: null,
    assigneeName: null,
    dueAt: "2026-07-11T02:00:00.000Z",
    ...overrides,
  };
}

const ASSIGNEES = [
  { id: "u-zhang", name: "张客服", username: "cs1" },
  { id: "u-wang", name: "王二客服", username: "cs2" },
];

const canned = { items: [] as ListItem[], total: 0 };
let calls: Array<{ path: string; input: unknown }>;

function respond(path: string, input: unknown): unknown {
  // The AppLayout bell polls notification.list in the same batch;
  // an empty inbox keeps these tests focused on the assignment surfaces.
  if (path === "notification.list") {
    return { items: [], unreadCount: 0, todo: { items: [], count: 0 } };
  }
  if (
    path === "channel.filterOptions" ||
    path === "ticketCategory.filterOptions" ||
    path === "sla.options" ||
    path === "completionStatus.filterOptions"
  ) {
    return [];
  }
  if (path === "ticket.list") {
    const page = ((input as Record<string, unknown> | undefined)?.page as number | undefined) ?? 1;
    return { items: canned.items, total: canned.total, page, pageSize: 20 };
  }
  if (path === "ticket.assigneeOptions") {
    return ASSIGNEES;
  }
  if (path === "ticket.assign") {
    const { ticketId, assigneeId } = input as { ticketId: string; assigneeId: string };
    return {
      id: ticketId,
      workOrderNumber: "WO100001",
      status: "assigned",
      assigneeName: ASSIGNEES.find((user) => user.id === assigneeId)?.name ?? "",
    };
  }
  if (path === "ticket.batchAssign") {
    const { ticketIds, assigneeId } = input as { ticketIds: string[]; assigneeId: string };
    return {
      assignedCount: ticketIds.length,
      assigneeName: ASSIGNEES.find((user) => user.id === assigneeId)?.name ?? "",
    };
  }
  if (path === "ticket.autoAssign") {
    const { ticketIds } = input as { ticketIds: string[] };
    return {
      assigned: ticketIds.map((ticketId) => ({
        ticketId,
        workOrderNumber: "WO100001",
        assigneeName: "张客服",
      })),
      skipped: [],
    };
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

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const trpcClient = trpc.createClient({
    links: [httpBatchLink({ url: "http://localhost/api/trpc", fetch: fakeFetch })],
  });

  return render(
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <MemoryRouter initialEntries={[path]}>
            <AppRoutes />
          </MemoryRouter>
        </ThemeProvider>
      </QueryClientProvider>
    </trpc.Provider>,
  );
}

async function pickAssignee(name: string) {
  const trigger = await screen.findByRole("combobox", { name: "责任人" });
  fireEvent.mouseDown(trigger);
  const option = await screen.findByRole("option", { name });
  fireEvent.click(option);
}

beforeEach(() => {
  auth.user = userWith(TEST_ROLES.CS_MANAGER);
  auth.isLoading = false;
  canned.items = [];
  canned.total = 0;
  calls = [];
});

describe("single assignment from the list", () => {
  it("分配 opens the dialog and confirming fires ticket.assign with the picked user", async () => {
    canned.items = [listItem()];
    canned.total = 1;
    renderAt("/tickets");
    await screen.findByText("WO100001");

    fireEvent.click(screen.getByRole("button", { name: "分配" }));
    expect(await screen.findByRole("heading", { name: "分配工单" })).toBeInTheDocument();

    await pickAssignee("张客服");
    fireEvent.click(screen.getByRole("button", { name: "确认" }));

    await waitFor(() =>
      expect(calls.find((call) => call.path === "ticket.assign")?.input).toEqual({
        ticketId: "t1",
        assigneeId: "u-zhang",
      }),
    );
  });

  it("打开时焦点落在责任人搜索框", async () => {
    canned.items = [listItem()];
    canned.total = 1;
    renderAt("/tickets");
    await screen.findByText("WO100001");

    fireEvent.click(screen.getByRole("button", { name: "分配" }));
    const search = await screen.findByRole("combobox", { name: "责任人" });
    await waitFor(() => expect(search).toHaveFocus());
  });

  it("责任人支持拼音首字母搜索,命中字高亮,回车选中", async () => {
    canned.items = [listItem()];
    canned.total = 1;
    renderAt("/tickets");
    await screen.findByText("WO100001");

    fireEvent.click(screen.getByRole("button", { name: "分配" }));
    await screen.findByRole("heading", { name: "分配工单" });
    const search = await screen.findByRole("combobox", { name: "责任人" });
    await waitFor(() => expect(search).not.toBeDisabled());
    fireEvent.mouseDown(search);

    fireEvent.change(search, { target: { value: "zkf" } });

    const hit = await screen.findByRole("option", { name: "张客服" });
    expect(screen.queryByRole("option", { name: "王二客服" })).not.toBeInTheDocument();
    expect(hit.querySelector("mark")).toHaveTextContent("张客服");

    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });
    await waitFor(() => expect(search).toHaveValue("张客服"));

    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    await waitFor(() =>
      expect(calls.find((call) => call.path === "ticket.assign")?.input).toEqual({
        ticketId: "t1",
        assigneeId: "u-zhang",
      }),
    );
  });

  it("改派 shows the current assignee with the deadline non-extension hint", async () => {
    canned.items = [
      listItem({
        status: "assigned",
        displayStatus: "assigned",
        assigneeId: "u-zhang",
        assigneeName: "张客服",
      }),
    ];
    canned.total = 1;
    renderAt("/tickets");
    await screen.findByText("WO100001");

    fireEvent.click(screen.getByRole("button", { name: "改派" }));
    expect(await screen.findByRole("heading", { name: "改派工单" })).toBeInTheDocument();
    expect(screen.getByText(/处理时限不因改派顺延/)).toBeInTheDocument();
    expect(screen.getByText("当前责任人：").parentElement).toHaveTextContent("张客服");
  });

  it("候选列表渲染 assigneeOptions 返回的用户，仅当前责任人置灰不可选", async () => {
    canned.items = [
      listItem({
        status: "assigned",
        displayStatus: "assigned",
        assigneeId: "u-zhang",
        assigneeName: "张客服",
      }),
    ];
    canned.total = 1;
    renderAt("/tickets");
    await screen.findByText("WO100001");

    fireEvent.click(screen.getByRole("button", { name: "改派" }));
    expect(await screen.findByRole("heading", { name: "改派工单" })).toBeInTheDocument();
    const trigger = await screen.findByRole("combobox", { name: "责任人" });
    await waitFor(() => expect(trigger).not.toBeDisabled());
    fireEvent.mouseDown(trigger);

    expect(await screen.findByRole("option", { name: "王二客服" })).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("option", { name: "张客服（当前责任人）" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });
});

describe("schedule-based automatic assignment", () => {
  it("offers unassigned tickets and confirms against the global current on-duty pool", async () => {
    canned.items = [listItem({ channel: "监管" })];
    canned.total = 1;
    renderAt("/tickets");
    await screen.findByText("WO100001");

    fireEvent.click(screen.getByRole("button", { name: "自动分配" }));
    expect(await screen.findByRole("heading", { name: "按排班自动分配" })).toBeInTheDocument();
    expect(screen.getByText(/当前所有在岗人员/)).toBeInTheDocument();
    expect(screen.queryByText(/渠道的当前在岗/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    await waitFor(() =>
      expect(calls.find((call) => call.path === "ticket.autoAssign")?.input).toEqual({
        ticketIds: ["t1"],
      }),
    );
  });
});

describe("批量分配 from the list", () => {
  it("selecting rows raises the batch bar and confirming fires ticket.batchAssign with all ids", async () => {
    canned.items = [
      listItem(),
      listItem({ id: "t2", workOrderNumber: "WO100002" }),
      listItem({ id: "t3", workOrderNumber: "WO100003" }),
    ];
    canned.total = 3;
    renderAt("/tickets");
    await screen.findByText("WO100001");

    fireEvent.click(screen.getByRole("checkbox", { name: "选择工单 WO100001" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "选择工单 WO100002" }));
    expect(screen.getByText("已选 2 个工单")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /批量分配/ }));
    expect(await screen.findByRole("heading", { name: "批量分配" })).toBeInTheDocument();
    expect(screen.getByText(/已选 2 个工单，统一分配给同一责任人/)).toBeInTheDocument();

    await pickAssignee("王二客服");
    fireEvent.click(screen.getByRole("button", { name: "确认" }));

    await waitFor(() =>
      expect(calls.find((call) => call.path === "ticket.batchAssign")?.input).toEqual({
        ticketIds: ["t1", "t2"],
        assigneeId: "u-wang",
      }),
    );
    await waitFor(() => expect(screen.queryByText("已选 2 个工单")).not.toBeInTheDocument());
  });

  it("warns when the selection contains already-assigned tickets (改派不顺延时限)", async () => {
    canned.items = [
      listItem(),
      listItem({
        id: "t2",
        workOrderNumber: "WO100002",
        status: "assigned",
        displayStatus: "assigned",
        assigneeId: "u-zhang",
        assigneeName: "张客服",
      }),
    ];
    canned.total = 2;
    renderAt("/tickets");
    await screen.findByText("WO100001");

    fireEvent.click(screen.getByRole("checkbox", { name: "选择工单 WO100001" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "选择工单 WO100002" }));
    fireEvent.click(screen.getByRole("button", { name: /批量分配/ }));

    expect(await screen.findByRole("heading", { name: "批量分配" })).toBeInTheDocument();
    expect(screen.getByText(/1\s*个工单已有责任人，将被改派/)).toBeInTheDocument();
  });

  it("the header checkbox selects every selectable row on the page", async () => {
    canned.items = [
      listItem(),
      listItem({ id: "t2", workOrderNumber: "WO100002" }),
      listItem({
        id: "t3",
        workOrderNumber: "WO100003",
        status: "completed",
        displayStatus: "completed",
      }),
    ];
    canned.total = 3;
    renderAt("/tickets");
    await screen.findByText("WO100001");

    fireEvent.click(screen.getByRole("checkbox", { name: "选择本页全部工单" }));
    expect(screen.getByText("已选 2 个工单")).toBeInTheDocument();
  });
});
