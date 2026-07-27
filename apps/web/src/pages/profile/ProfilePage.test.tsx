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
 * 修改密码 block on the profile page: fires auth.changeOwnPassword with the
 * old + new password, clears the form on success, surfaces server rejections,
 * and disappears entirely for roles holding the restrictive point. Same
 * faked-fetch tRPC pipeline and useAuth-seam mock as the users-page tests.
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
    id: "u-me",
    username: "tester",
    name: "测试用户",
    email: null,
    team: null,
    roleId: "r1",
    roleName: role.name,
    permissions: [...role.permissions],
    requiredTicketFields: [],
    externalOrgId: null,
  };
}

let calls: Array<{ path: string; input: unknown }>;
/** When set, the named path answers with a tRPC error instead of data. */
let serverError: { path: string; message: string; code: string; httpStatus: number } | null;

function respond(path: string, _input: unknown): unknown {
  if (path === "notification.list") {
    return { items: [], unreadCount: 0, todo: { items: [], count: 0 } };
  }
  if (path === "auth.changeOwnPassword") {
    return undefined;
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
    if (serverError && serverError.path === path) {
      return {
        error: {
          message: serverError.message,
          code: -32600,
          data: { code: serverError.code, httpStatus: serverError.httpStatus, zodError: null },
        },
      };
    }
    return { result: { data: respond(path, procedureInput) } };
  });
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

function renderProfilePage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const trpcClient = trpc.createClient({
    links: [httpBatchLink({ url: "http://localhost/api/trpc", fetch: fakeFetch })],
  });

  return render(
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <MemoryRouter initialEntries={["/profile"]}>
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
  calls = [];
  serverError = null;
});

async function submitChange(oldPassword: string, newPassword: string) {
  fireEvent.change(await screen.findByLabelText("旧密码"), { target: { value: oldPassword } });
  fireEvent.change(screen.getByLabelText("新密码"), { target: { value: newPassword } });
  fireEvent.click(screen.getByRole("button", { name: "修改密码" }));
}

describe("修改密码 block", () => {
  it("submits old + new password through auth.changeOwnPassword and clears the form", async () => {
    renderProfilePage();
    await submitChange("old-pass-1", "new-pass-2");

    await waitFor(() =>
      expect(calls).toContainEqual({
        path: "auth.changeOwnPassword",
        input: { oldPassword: "old-pass-1", newPassword: "new-pass-2" },
      }),
    );
    // Success feedback: the form resets to empty
    await waitFor(() => expect(screen.getByLabelText("旧密码")).toHaveValue(""));
    expect(screen.getByLabelText("新密码")).toHaveValue("");
  });

  it("surfaces a server rejection (旧密码不正确) without clearing the form", async () => {
    serverError = {
      path: "auth.changeOwnPassword",
      message: "旧密码不正确",
      code: "BAD_REQUEST",
      httpStatus: 400,
    };
    renderProfilePage();
    await submitChange("wrong-old", "new-pass-2");

    await screen.findByText("修改失败");
    expect(screen.getByText("旧密码不正确")).toBeInTheDocument();
    expect(screen.getByLabelText("旧密码")).toHaveValue("wrong-old");
  });

  it("rejects a too-short new password client-side, no request fired", async () => {
    renderProfilePage();
    await submitChange("old-pass-1", "123");

    await screen.findByText("密码至少 6 位");
    expect(calls.filter((call) => call.path === "auth.changeOwnPassword")).toHaveLength(0);
  });

  it("is hidden for a role holding user.forbid_change_own_password", async () => {
    auth.user = userWith({
      name: "受限角色",
      permissions: ["dashboard.view", "user.forbid_change_own_password"],
    });
    renderProfilePage();

    // The read-only profile card still renders...
    await screen.findByRole("heading", { name: "个人资料" });
    expect(screen.getByText("tester")).toBeInTheDocument();
    // ...but the password block is gone
    expect(screen.queryByText("修改密码")).not.toBeInTheDocument();
  });
});
