import type { Permission } from "@insuredesk/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { httpBatchLink } from "@trpc/client";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "@/contexts/AuthContext";
import { trpc } from "@/lib/trpc";
import { TEST_ROLES } from "@/test/roles";
import { AppRoutes } from "../../AppRoutes";
import { ThemeProvider } from "../../components/ThemeProvider";

/**
 * Route-driven detail dialog: /tickets/:id renders 工单管理 with the detail
 * dialog open, so a row click, a bell/todo jump, a refresh or a new tab all
 * land on the same list+dialog composition. Closing the dialog returns to
 * /tickets with the filter query string it carried in. Same faked-fetch tRPC
 * pipeline and useAuth-seam mock as the sibling ticket tests.
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

/** serializeTicketDetail wire shape, 已完结 so every section renders. */
function detailPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "t1",
    workOrderNumber: "WO100001",
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
    followUpFrequency: "每天跟进",
    firstResponseRequirement: "24小时内",
    status: "completed",
    displayStatus: "completed",
    assigneeId: "u1",
    assigneeName: "测试用户",
    assignedAt: "2026-07-09T03:00:00.000Z",
    dueAt: "2026-07-11T02:00:00.000Z",
    nextContactTime: null,
    contactCount: 1,
    processingResult: "已电话联系客户",
    completionTime: "2026-07-10T02:00:00.000Z",
    completionStatus: "正常完结",
    processLogs: [
      {
        id: "log1",
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
    ...overrides,
  };
}

/** One list row whose click target is the detail dialog. */
const listItem = {
  id: "t1",
  workOrderNumber: "WO100001",
  createdAt: "2026-07-09T02:00:00.000Z",
  source: "manual",
  channel: "保司",
  category: "理赔投诉",
  complaintLevel: "一般投诉",
  customerName: "王小明",
  policyNumber: "P2026070900123",
  status: "completed",
  displayStatus: "completed",
  assigneeName: "测试用户",
  dueAt: "2026-07-11T02:00:00.000Z",
};

// Canned payloads + a log of every decoded ticket.list input.
let detail: Record<string, unknown>;
let listInputs: Array<Record<string, unknown>>;

function respond(path: string, input: unknown): unknown {
  // The AppLayout bell polls notification.list in the same batch
  if (path === "notification.list") {
    return { items: [], unreadCount: 0, todo: { items: [], count: 0 } };
  }
  if (path === "ticket.detail") {
    return detail;
  }
  if (path === "ticket.list") {
    listInputs.push((input as Record<string, unknown> | undefined) ?? {});
    return { items: [listItem], total: 1, page: 1, pageSize: 20 };
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

beforeEach(() => {
  auth.user = userWith(TEST_ROLES.CS_MANAGER);
  auth.isLoading = false;
  detail = detailPayload();
  listInputs = [];
});

describe("deep link /tickets/:id", () => {
  it("renders the list with the detail dialog open on top", async () => {
    renderAt("/tickets/t1");

    // The list is there underneath — aria-hidden while the modal is open…
    expect(
      await screen.findByRole("heading", { name: "工单管理", hidden: true }),
    ).toBeInTheDocument();
    // …and the dialog shows the full read-only detail: title, every section,
    // the timeline
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("WO100001");
    for (const section of [
      "基本信息",
      "业务信息",
      "客户信息",
      "分类与等级",
      "处理状态",
      "完结信息",
      "处理记录",
    ]) {
      expect(dialog).toHaveTextContent(section);
    }
    expect(dialog).toHaveTextContent("创建工单"); // timeline entry
  });

  it("keeps the carried filter query string in the list query", async () => {
    renderAt("/tickets/t1?status=overdue");

    await screen.findByRole("dialog");
    await waitFor(() => expect(listInputs.length).toBeGreaterThan(0));
    expect(listInputs[0]).toMatchObject({ status: "overdue" });
  });
});

describe("row click → dialog → close", () => {
  it("opens the detail dialog over the list, then closes back to the filtered list", async () => {
    renderAt("/tickets?status=overdue");

    // Row click navigates to /tickets/:id, opening the dialog
    fireEvent.click(await screen.findByText("王小明"));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("处理记录");

    // Closing returns to the list with the filter untouched
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "工单管理" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "状态" })).toHaveTextContent("已超时");
  });
});
