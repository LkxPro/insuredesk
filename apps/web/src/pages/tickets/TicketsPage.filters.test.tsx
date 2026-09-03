import type { Permission } from "@insuredesk/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { httpBatchLink } from "@trpc/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "@/contexts/AuthContext";
import { trpc } from "@/lib/trpc";
import { TEST_ROLES } from "@/test/roles";
import { AppRoutes } from "../../AppRoutes";
import { ThemeProvider } from "../../components/ThemeProvider";

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

const ASSIGNEES = [
  { id: "u-zhang", name: "张客服", username: "cs1" },
  { id: "u-wang", name: "王二客服", username: "cs2" },
];

let calls: Array<{ path: string; input: unknown }>;

function respond(path: string, input: unknown): unknown {
  // The AppLayout bell polls notification.list in the same batch.
  if (path === "notification.list") {
    return { items: [], unreadCount: 0, todo: { items: [], count: 0 } };
  }
  if (
    path === "ticketKind.filterOptions" ||
    path === "channel.filterOptions" ||
    path === "ticketCategory.filterOptions" ||
    path === "sla.options" ||
    path === "completionStatus.filterOptions"
  ) {
    return [];
  }
  if (path === "ticket.list") {
    const page = ((input as Record<string, unknown> | undefined)?.page as number | undefined) ?? 1;
    return { items: [], total: 0, page, pageSize: 20 };
  }
  if (path === "ticket.assigneeOptions") {
    return ASSIGNEES;
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

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
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
            <Routes>
              <Route path="*" element={<LocationProbe />} />
            </Routes>
          </MemoryRouter>
        </ThemeProvider>
      </QueryClientProvider>
    </trpc.Provider>,
  );
}

function locationText() {
  return screen.getByTestId("location").textContent;
}

function listCalls() {
  return calls.filter((call) => call.path === "ticket.list");
}

beforeEach(() => {
  auth.user = {
    id: "u1",
    username: "tester",
    name: "测试用户",
    email: null,
    team: null,
    roleId: "r1",
    roleName: TEST_ROLES.CS_MANAGER.name,
    permissions: [...TEST_ROLES.CS_MANAGER.permissions],
    requiredTicketFields: [],
    isExternal: false,
  };
  auth.isLoading = false;
  calls = [];
});

describe("筛选 URL 契约", () => {
  it("深链 assigneeId / firstResponse / slaPolicyId=none 进入 ticket.list 入参", async () => {
    renderAt("/tickets?assigneeId=u-zhang&firstResponse=pending&slaPolicyId=none");

    await waitFor(() => expect(listCalls().length).toBeGreaterThan(0));
    expect(listCalls().at(-1)?.input).toMatchObject({
      assigneeId: ["u-zhang"],
      firstResponse: "pending",
      slaPolicyId: ["none"],
    });
  });

  it("policyId 遗留别名解析为 slaPolicyId 入参", async () => {
    renderAt("/tickets?policyId=sla-1");

    await waitFor(() => expect(listCalls().length).toBeGreaterThan(0));
    expect(listCalls().at(-1)?.input).toMatchObject({ slaPolicyId: ["sla-1"] });
  });

  it("勾选责任人筛选项写 URL 并驱动查询", async () => {
    renderAt("/tickets");
    await waitFor(() => expect(listCalls().length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole("button", { name: "责任人" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "张客服" }));

    await waitFor(() =>
      expect(listCalls().at(-1)?.input).toMatchObject({ assigneeId: ["u-zhang"] }),
    );
  });

  it("首响切换到待首响写 URL 并驱动查询", async () => {
    renderAt("/tickets");
    await waitFor(() => expect(listCalls().length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole("combobox", { name: "首响" }));
    fireEvent.click(await screen.findByRole("option", { name: "待首响" }));

    await waitFor(() =>
      expect(listCalls().at(-1)?.input).toMatchObject({ firstResponse: "pending" }),
    );
  });

  it("策略筛选回写规范参数名 slaPolicyId 并清掉遗留别名", async () => {
    renderAt("/tickets?policyId=sla-legacy");
    await waitFor(() => expect(listCalls().length).toBeGreaterThan(0));
    expect(locationText()).toContain("policyId=sla-legacy");

    fireEvent.click(screen.getByRole("button", { name: "时效策略" }));
    fireEvent.click(await screen.findByRole("button", { name: "清空" }));

    await waitFor(() => {
      const input = listCalls().at(-1)?.input as Record<string, unknown> | undefined;
      expect(input?.slaPolicyId).toBeUndefined();
    });
    expect(locationText()).toBe("/tickets");
  });
});
