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
 * QuickLook 键盘浏览: with the detail dialog open, ↑/↓ swaps in the
 * previous/next ticket of the CURRENT list page — the order the rows are in,
 * i.e. the active filter + sort — replacing the dialog content in place and
 * keeping the URL in step. The first row's ↑ and the last row's ↓ do nothing
 * (no page turn, no error), and a dirty edit draft intercepts the jump behind
 * the same 丢弃修改？ confirmation as every other way out. Same faked-fetch
 * tRPC pipeline and useAuth-seam mock as the sibling detail-dialog tests.
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

/** serializeTicketDetail wire shape with in-flight defaults. */
function detailPayload(id: string, workOrderNumber: string) {
  return {
    id,
    workOrderNumber,
    createdAt: "2026-07-09T02:00:00.000Z",
    updatedAt: "2026-07-09T03:00:00.000Z",
    feedbackTime: "2026-07-09T01:00:00.000Z",
    source: "manual",
    createdBy: "测试用户",
    channel: { id: "ch-baosi", name: "保司", active: true },
    project: "融盛",
    brokerageEntity: "东方大地",
    paymentChannel: "连连支付",
    internalOrderNumber: null,
    policyNumber: "P2026070900123",
    userComplaintChannel: "400热线",
    complaintReceiveChannel: null,
    customerName: "王小明",
    phone: "13800000001",
    contactPhone: null,
    customerRequest: "对理赔进度有异议",
    nuclearBodyStatus: "待核实",
    hasContacted: false,
    contactTime: null,
    contactId: null,
    category: { id: "cat-claims", name: "理赔投诉", active: true },
    complaintLevel: "一般投诉",
    priority: null,
    followUpFrequency: "24小时内累计跟进1次",
    firstResponseRequirement: "120分钟内完成首次响应",
    status: "processing",
    displayStatus: "processing",
    assigneeId: "u1",
    assigneeName: "测试用户",
    assignedAt: "2026-07-09T03:00:00.000Z",
    dueAt: "2026-07-11T02:00:00.000Z",
    nextContactTime: null,
    contactCount: 1,
    processingResult: "已电话联系客户",
    completionTime: null,
    completionStatus: null,
    processLogs: [
      {
        id: `log-${id}`,
        operatorId: "u1",
        operatorName: "测试用户",
        operatorAvatar: null,
        action: "create",
        from: null,
        to: null,
        remark: "创建工单",
        at: "2026-07-09T02:00:00.000Z",
      },
    ],
  };
}

const DETAILS: Record<string, Record<string, unknown>> = {
  t1: detailPayload("t1", "WO100001"),
  t2: detailPayload("t2", "WO100002"),
  t3: detailPayload("t3", "WO100003"),
};

/** The page's three rows, in list order — the order the arrow keys walk. */
function listItem(id: string, workOrderNumber: string) {
  return {
    id,
    workOrderNumber,
    createdAt: "2026-07-09T02:00:00.000Z",
    source: "manual",
    channel: "保司",
    category: "理赔投诉",
    complaintLevel: "一般投诉",
    customerName: "王小明",
    policyNumber: "P2026070900123",
    status: "processing",
    displayStatus: "processing",
    assigneeId: "u1",
    assigneeName: "测试用户",
    dueAt: "2026-07-11T02:00:00.000Z",
  };
}

const LIST_ITEMS = [
  listItem("t1", "WO100001"),
  listItem("t2", "WO100002"),
  listItem("t3", "WO100003"),
];

// Logs of every decoded ticket.detail id and ticket.list input.
let detailIds: string[];
let listInputs: Array<Record<string, unknown>>;

function respond(path: string, input: unknown): unknown {
  // The AppLayout bell polls notification.list in the same batch
  if (path === "notification.list") {
    return { items: [], unreadCount: 0, todo: { items: [], count: 0 } };
  }
  if (path === "ticket.detail") {
    const { id } = input as { id: string };
    detailIds.push(id);
    const payload = DETAILS[id];
    if (!payload) throw new Error(`Unexpected ticket.detail id: ${id}`);
    return payload;
  }
  if (path === "ticket.list") {
    listInputs.push((input as Record<string, unknown> | undefined) ?? {});
    return { items: LIST_ITEMS, total: 3, page: 1, pageSize: 20 };
  }
  // The list renders behind the route-driven detail dialog; the option feeds
  // serve both its filter toolbar and the edit mode's pickers
  if (
    path === "ticket.assigneeOptions" ||
    path === "ticketCategory.options" ||
    path === "channel.options" ||
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

/** The detail dialog, asserted settled on the given 工单号. */
async function findDialogShowing(workOrderNumber: string) {
  await waitFor(() => expect(screen.getByRole("dialog")).toHaveTextContent(workOrderNumber));
  return screen.getByRole("dialog");
}

beforeEach(() => {
  auth.user = userWith(TEST_ROLES.CS_MANAGER);
  auth.isLoading = false;
  detailIds = [];
  listInputs = [];
});

describe("↑/↓ QuickLook switching", () => {
  it("walks prev/next in list order, swapping the SAME dialog's content and keeping the filter", async () => {
    renderAt("/tickets/t2?status=overdue");
    const dialog = await findDialogShowing("WO100002");

    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    await findDialogShowing("WO100003");
    // Content swapped in place: still exactly one dialog, list still behind it
    expect(screen.getAllByRole("dialog")).toHaveLength(1);

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowUp" });
    await findDialogShowing("WO100002");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowUp" });
    await findDialogShowing("WO100001");
    expect(detailIds).toEqual(["t2", "t3", "t2", "t1"]);

    // The carried filter survived the arrow browsing: closing lands on the
    // list with 状态=已超时 still applied
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("combobox", { name: "状态" })).toHaveTextContent("已超时");
  });

  it("↑ on the first row and ↓ on the last row do nothing — no page turn, no error", async () => {
    const first = renderAt("/tickets/t1");
    const dialogAtFirst = await findDialogShowing("WO100001");
    fireEvent.keyDown(dialogAtFirst, { key: "ArrowUp" });
    // A jump would swap the content for a loading skeleton synchronously
    expect(screen.getByRole("dialog")).toHaveTextContent("WO100001");
    expect(detailIds).toEqual(["t1"]);
    first.unmount();

    detailIds = [];
    renderAt("/tickets/t3");
    const dialogAtLast = await findDialogShowing("WO100003");
    fireEvent.keyDown(dialogAtLast, { key: "ArrowDown" });
    expect(screen.getByRole("dialog")).toHaveTextContent("WO100003");
    expect(detailIds).toEqual(["t3"]);
    // Never asked the server for another page
    expect(listInputs.every((input) => ((input.page as number | undefined) ?? 1) === 1)).toBe(true);
  });
});

describe("edit mode and the arrow keys", () => {
  it("a dirty draft diverts the jump to 丢弃修改？ — discard switches, 继续编辑 stays", async () => {
    renderAt("/tickets/t1");
    await findDialogShowing("WO100001");

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(await screen.findByLabelText("客户姓名"), { target: { value: "王大明" } });

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowDown" });
    expect(await screen.findByText("丢弃修改？")).toBeInTheDocument();
    // Nothing switched yet, and further arrows are inert behind the confirm
    fireEvent.keyDown(screen.getByText("丢弃修改？"), { key: "ArrowDown" });
    expect(screen.getByLabelText("客户姓名")).toHaveValue("王大明");
    expect(detailIds).toEqual(["t1"]);

    fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
    await waitFor(() => expect(screen.queryByText("丢弃修改？")).not.toBeInTheDocument());
    expect(screen.getByLabelText("客户姓名")).toHaveValue("王大明");

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("button", { name: "丢弃修改" }));
    // The jump lands read-only on the next ticket; the discarded draft is gone
    await findDialogShowing("WO100002");
    expect(screen.queryByLabelText("客户姓名")).not.toBeInTheDocument();
    expect(screen.queryByText("丢弃修改？")).not.toBeInTheDocument();
  });

  it("a clean edit session switches straight away, landing read-only", async () => {
    renderAt("/tickets/t2");
    await findDialogShowing("WO100002");

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    await screen.findByLabelText("客户姓名");

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowDown" });
    await findDialogShowing("WO100003");
    expect(screen.queryByText("丢弃修改？")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("客户姓名")).not.toBeInTheDocument();
  });

  it("arrows typed into a field never switch tickets", async () => {
    renderAt("/tickets/t1");
    await findDialogShowing("WO100001");

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    const nameInput = await screen.findByLabelText("客户姓名");
    fireEvent.change(nameInput, { target: { value: "王大明" } });

    fireEvent.keyDown(nameInput, { key: "ArrowDown" });
    expect(screen.queryByText("丢弃修改？")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveTextContent("WO100001");
    expect(detailIds).toEqual(["t1"]);
  });
});
