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
 * 完结工单 from the detail dialog: confirming fires ticket.resolve with the
 * mandatory 完结状态目录引用 (options from completionStatus.options, 启用项
 * only) plus the 完结备注. Same faked-fetch tRPC pipeline and useAuth-seam
 * mock as the follow-up tests.
 */

/** The catalog options feed (启用项 only) the dialog pulls. */
const completionStatusOptions = [
  { id: "cs-negotiated", name: "已协商解决" },
  { id: "cs-normal", name: "正常完结" },
  { id: "cs-invalid", name: "无效工单" },
];

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
    policyNumbers: ["P2026070900123"],
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

// Canned detail payload + a log of every decoded call.
let detail: Record<string, unknown>;
let calls: Array<{ path: string; input: unknown }>;

function respond(path: string, input: unknown): unknown {
  // The AppLayout bell polls notification.list in the same batch
  if (path === "notification.list") {
    return { items: [], unreadCount: 0, todo: { items: [], count: 0 } };
  }
  if (path === "ticket.detail") {
    return detail;
  }
  // The list renders behind the route-driven detail dialog
  if (path === "ticket.list") {
    return { items: [], total: 0, page: 1, pageSize: 20 };
  }
  if (
    path === "channel.filterOptions" ||
    path === "ticketCategory.filterOptions" ||
    path === "completionStatus.filterOptions"
  ) {
    return [];
  }
  if (path === "completionStatus.options") {
    return completionStatusOptions;
  }
  if (path === "ticket.resolve") {
    const { ticketId, completionStatusId } = input as {
      ticketId: string;
      completionStatusId: string;
    };
    return {
      id: ticketId,
      workOrderNumber: "WO100001",
      status: "completed",
      completionStatus: completionStatusOptions.find((o) => o.id === completionStatusId)?.name,
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

function renderDetail() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const trpcClient = trpc.createClient({
    links: [httpBatchLink({ url: "http://localhost/api/trpc", fetch: fakeFetch })],
  });

  return render(
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <MemoryRouter initialEntries={["/tickets/t1"]}>
            <AppRoutes />
          </MemoryRouter>
        </ThemeProvider>
      </QueryClientProvider>
    </trpc.Provider>,
  );
}

beforeEach(() => {
  auth.user = userWith(TEST_ROLES.FRONTLINE_CS);
  auth.isLoading = false;
  detail = detailPayload();
  calls = [];
});

describe("resolving from the dialog", () => {
  it("requires both 完结状态 and 完结备注, fires ticket.resolve, then refetches the detail", async () => {
    renderDetail();

    fireEvent.click(await screen.findByRole("button", { name: "完结工单" }));
    const confirm = await screen.findByRole("button", { name: "确认完结" });
    expect(confirm).toBeDisabled(); // nothing picked, nothing written yet

    // Pick a catalog option — the select holds the reference id
    const trigger = screen.getByRole("combobox", { name: "完结状态" });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerId: 1 });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("option", { name: "已协商解决" }));
    expect(confirm).toBeDisabled(); // remark still missing

    fireEvent.change(screen.getByLabelText("完结备注"), {
      target: { value: "客户认可处理方案，双方达成一致" },
    });
    fireEvent.click(confirm);

    await waitFor(() => {
      expect(calls.some((call) => call.path === "ticket.resolve")).toBe(true);
    });
    const mutation = calls.find((call) => call.path === "ticket.resolve");
    expect(mutation?.input).toEqual({
      ticketId: "t1",
      completionStatusId: "cs-negotiated",
      remark: "客户认可处理方案，双方达成一致",
    });

    // Status, 完结信息 and the timeline all change server-side → refetch
    await waitFor(() => {
      expect(calls.filter((call) => call.path === "ticket.detail").length).toBeGreaterThan(1);
    });
  });

  it("offers exactly the catalog's 启用项 as options", async () => {
    renderDetail();

    fireEvent.click(await screen.findByRole("button", { name: "完结工单" }));
    const trigger = await screen.findByRole("combobox", { name: "完结状态" });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerId: 1 });
    fireEvent.click(trigger);

    await screen.findByRole("option", { name: "正常完结" });
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(
      completionStatusOptions.map((option) => option.name),
    );
  });
});
