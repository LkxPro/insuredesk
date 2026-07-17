import type { Permission } from "@insuredesk/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { httpBatchLink } from "@trpc/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "@/contexts/AuthContext";
import { trpc } from "@/lib/trpc";
import { TEST_ROLES } from "@/test/roles";
import { AppRoutes } from "../../AppRoutes";
import { ThemeProvider } from "../../components/ThemeProvider";

/**
 * 批量导入 entry point: the 导入 button is gated on ticket.import
 * (无权限 UI 无入口 — even the exporting 客服主管 lacks it until 勾选), the
 * dialog's 下载模板 fetches GET /api/tickets/import-template, and a server
 * rejection surfaces as a toast. Same useAuth-seam mock and faked tRPC fetch
 * as TicketsPage.export.test.tsx.
 */

const auth = vi.hoisted(() => ({
  user: null as AuthUser | null,
  isLoading: false,
}));

// The Toaster outlet lives in main.tsx, outside this render tree — spy on the
// imperative API instead of hunting for rendered toast text.
const toastSpies = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: toastSpies }));

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
    roleId: "r1",
    roleName: role.name,
    permissions: [...role.permissions],
    requiredTicketFields: [],
  };
}

/** 客服主管 plus the manually 勾选-ed ticket.import. */
const IMPORTER = {
  name: "客服主管",
  permissions: [...TEST_ROLES.CS_MANAGER.permissions, "ticket.import"] as Permission[],
};

/** tRPC batched queries arrive as GET with `input={"0":…}` in the URL. */
function fakeTrpcFetch(input: RequestInfo | URL): Promise<Response> {
  const url = new URL(String(input));
  const paths = (url.pathname.split("/api/trpc/")[1] ?? "").split(",");
  const body = paths.map((path) => {
    if (path === "notification.list") {
      return { result: { data: { items: [], unreadCount: 0, todo: { items: [], count: 0 } } } };
    }
    if (path === "channel.filterOptions") {
      return { result: { data: [] } };
    }
    return { result: { data: { items: [], total: 0, page: 1, pageSize: 20 } } };
  });
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

// The template download's own fetch — global, unlike the tRPC link's injected one.
const downloadFetch = vi.fn();

function renderTickets() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const trpcClient = trpc.createClient({
    links: [httpBatchLink({ url: "http://localhost/api/trpc", fetch: fakeTrpcFetch })],
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

beforeEach(() => {
  auth.user = userWith(IMPORTER);
  auth.isLoading = false;
  downloadFetch.mockReset();
  toastSpies.error.mockReset();
  vi.stubGlobal("fetch", downloadFetch);
  // jsdom has no object-URL implementation; the download path needs both ends
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: vi.fn(() => "blob:mock"),
      revokeObjectURL: vi.fn(),
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function openImportDialog() {
  fireEvent.click(await screen.findByRole("button", { name: /导入/ }));
  return screen.findByRole("dialog", { name: "导入工单" });
}

describe("permission gating (无权限 UI 无入口)", () => {
  it("hides the 导入 button without ticket.import — export alone is not enough", async () => {
    auth.user = userWith(TEST_ROLES.CS_MANAGER); // ticket.export but no import
    renderTickets();

    expect(await screen.findByRole("button", { name: /导出/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /导入/ })).not.toBeInTheDocument();
  });

  it("shows the 导入 button for holders of ticket.import", async () => {
    renderTickets();
    expect(await screen.findByRole("button", { name: /导入/ })).toBeInTheDocument();
  });
});

describe("导入弹窗", () => {
  it("opens with 下载模板 and the upload placeholder", async () => {
    renderTickets();
    const dialog = await openImportDialog();

    expect(dialog).toHaveTextContent("下载模板");
    expect(dialog).toHaveTextContent("上传功能即将上线");
  });

  it("下载模板 fetches the dynamic template endpoint", async () => {
    downloadFetch.mockResolvedValue(
      new Response("xlsx", {
        status: 200,
        headers: {
          "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
      }),
    );
    renderTickets();
    await openImportDialog();

    fireEvent.click(screen.getByRole("button", { name: /下载模板/ }));

    await waitFor(() => expect(downloadFetch).toHaveBeenCalledTimes(1));
    const url = new URL(String(downloadFetch.mock.calls[0]?.[0]), "http://localhost");
    expect(url.pathname).toBe("/api/tickets/import-template");
    expect(toastSpies.error).not.toHaveBeenCalled();
  });

  it("surfaces a server rejection as a toast", async () => {
    downloadFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: "Missing required permission: ticket.import" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    );
    renderTickets();
    await openImportDialog();

    fireEvent.click(screen.getByRole("button", { name: /下载模板/ }));

    await waitFor(() =>
      expect(toastSpies.error).toHaveBeenCalledWith("Missing required permission: ticket.import"),
    );
  });
});
