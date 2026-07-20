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
 * Assignment entry points: 分配/改派/批量分配 exist only for holders of the
 * matching permission (mirroring the API guards), the dialog carries the
 * "时限不顺延" hint on reassignment, and confirming fires the right mutation
 * with the right payload. Same faked-fetch tRPC pipeline and useAuth-seam
 * mock as TicketsPage.list.test.tsx.
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
  policyNumber: string;
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
    policyNumber: "P2026070900123",
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

// Canned per-procedure payloads + a log of every decoded call.
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

/** Open the 责任人 dropdown and pick a user by name. */
async function pickAssignee(name: string) {
  const trigger = await screen.findByRole("combobox", { name: "责任人" });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerId: 1 });
  fireEvent.click(trigger);
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

describe("entry-point gating", () => {
  it("只读观察 (no assign permissions) sees no checkboxes, no 操作 column, no assign buttons", async () => {
    auth.user = userWith(TEST_ROLES.READ_ONLY);
    canned.items = [listItem()];
    canned.total = 1;
    renderAt("/tickets");

    await screen.findByText("WO100001");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByText("操作")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "分配" })).not.toBeInTheDocument();
  });

  it("客服主管 sees 分配 on unassigned rows, 改派 on assigned rows, nothing on completed rows", async () => {
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
      listItem({
        id: "t3",
        workOrderNumber: "WO100003",
        status: "completed",
        displayStatus: "completed",
        assigneeId: "u-zhang",
        assigneeName: "张客服",
      }),
    ];
    canned.total = 3;
    renderAt("/tickets");

    await screen.findByText("WO100001");
    expect(screen.getByRole("button", { name: "分配" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "改派" })).toBeInTheDocument();
    // 2 action buttons for 3 rows: the completed 终态 row has none, and its
    // checkbox is not selectable either
    expect(screen.getByRole("checkbox", { name: "选择工单 WO100003" })).toBeDisabled();
  });
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

  it("改派 shows the current assignee with the ADR 0002 non-extension hint", async () => {
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

  it("候选人来自 ticket.assigneeOptions（全部启用用户，与排班无关），仅当前责任人置灰 (#42)", async () => {
    // 手动分配与排班相互独立: the dialog's people picker is the schedule-free
    // active-user list — no schedule.* procedure is consulted, and every
    // option except the current assignee is selectable.
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
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerId: 1 });
    fireEvent.click(trigger);

    // The off-roster user is offered and selectable; only the current
    // assignee is disabled (self-reassign is a no-op)
    const offRoster = await screen.findByRole("option", { name: "王二客服" });
    expect(offRoster).not.toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("option", { name: "张客服（当前责任人）" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    expect(calls.some((call) => call.path === "ticket.assigneeOptions")).toBe(true);
    expect(calls.every((call) => !call.path.startsWith("schedule."))).toBe(true);
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
    // Selection is spent after a successful batch
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
    // The completed row is skipped
    expect(screen.getByText("已选 2 个工单")).toBeInTheDocument();
  });
});
