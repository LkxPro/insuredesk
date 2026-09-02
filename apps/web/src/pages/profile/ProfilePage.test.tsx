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
    id: "u-me",
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

let calls: Array<{ path: string; input: unknown }>;
let serverError: { path: string; message: string; code: string; httpStatus: number } | null;

type ApiKeyRow = {
  id: string;
  name: string;
  status: "active" | "revoked" | "expired";
  keyPreview: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
};

const API_KEY_ROLE = { name: "集成对接", permissions: ["api_key.manage"] as Permission[] };

const ACTIVE_KEY: ApiKeyRow = {
  id: "k1",
  name: "报表同步",
  status: "active",
  keyPreview: "w9x2y8zq",
  expiresAt: "2027-01-01T00:00:00.000Z",
  lastUsedAt: "2026-09-01T08:00:00.000Z",
  createdAt: "2026-08-01T00:00:00.000Z",
};
const REVOKED_KEY: ApiKeyRow = {
  id: "k2",
  name: "旧脚本",
  status: "revoked",
  keyPreview: "deadbeef",
  expiresAt: "2026-12-01T00:00:00.000Z",
  lastUsedAt: null,
  createdAt: "2026-07-01T00:00:00.000Z",
};
const EXPIRED_KEY: ApiKeyRow = {
  id: "k3",
  name: "临时对接",
  status: "expired",
  keyPreview: "expired8",
  expiresAt: "2020-01-01T00:00:00.000Z",
  lastUsedAt: null,
  createdAt: "2026-06-01T00:00:00.000Z",
};
const NEVER_KEY: ApiKeyRow = {
  id: "k4",
  name: "长期集成",
  status: "active",
  keyPreview: "forever8",
  expiresAt: null,
  lastUsedAt: null,
  createdAt: "2026-05-01T00:00:00.000Z",
};
const LEGACY_KEY: ApiKeyRow = {
  id: "k5",
  name: "存量旧 key",
  status: "active",
  keyPreview: "",
  expiresAt: null,
  lastUsedAt: null,
  createdAt: "2026-04-01T00:00:00.000Z",
};

const canned = {
  apiKeys: [] as ApiKeyRow[],
  created: null as (ApiKeyRow & { key: string }) | null,
};

function respond(path: string, _input: unknown): unknown {
  if (path === "notification.list") {
    return { items: [], unreadCount: 0, todo: { items: [], count: 0 } };
  }
  if (path === "auth.changeOwnPassword") {
    return undefined;
  }
  if (path === "apiKey.list") {
    const includeRevoked = (_input as { includeRevoked?: boolean } | undefined)?.includeRevoked;
    return includeRevoked
      ? canned.apiKeys
      : canned.apiKeys.filter((key) => key.status !== "revoked");
  }
  if (path === "apiKey.create") {
    return canned.created;
  }
  if (path === "apiKey.revoke") {
    return { id: (_input as { id: string }).id };
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
  canned.apiKeys = [];
  canned.created = null;
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

    await screen.findByRole("heading", { name: "个人资料" });
    expect(screen.getByText("tester")).toBeInTheDocument();
    expect(screen.queryByText("修改密码")).not.toBeInTheDocument();
  });
});

describe("API key 管理", () => {
  it("无 api_key.manage 不渲染卡片，也不请求 apiKey 接口", async () => {
    renderProfilePage();

    await screen.findByRole("heading", { name: "个人资料" });
    expect(screen.queryByText("API key")).not.toBeInTheDocument();
    expect(calls.some((call) => call.path.startsWith("apiKey."))).toBe(false);
  });

  it("持有 api_key.manage 时渲染列表：名称/前缀/时间，默认隐藏已吊销", async () => {
    auth.user = userWith(API_KEY_ROLE);
    canned.apiKeys = [ACTIVE_KEY, REVOKED_KEY];
    renderProfilePage();

    await screen.findByText("报表同步");
    expect(screen.queryByText("旧脚本")).not.toBeInTheDocument();
    expect(screen.getByText("sk_…w9x2y8zq")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "吊销" })).toBeEnabled();
  });

  it("勾选「显示已吊销」后以 includeRevoked 重新拉取并展示已吊销行", async () => {
    auth.user = userWith(API_KEY_ROLE);
    canned.apiKeys = [ACTIVE_KEY, REVOKED_KEY];
    renderProfilePage();
    await screen.findByText("报表同步");

    fireEvent.click(screen.getByRole("checkbox", { name: "显示已吊销" }));

    await screen.findByText("旧脚本");
    expect(screen.getByText("已吊销")).toBeInTheDocument();
    expect(screen.getByText("sk_…deadbeef")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.path === "apiKey.list" &&
            (call.input as { includeRevoked?: boolean })?.includeRevoked === true,
        ),
      ).toBe(true),
    );
    expect(screen.getAllByRole("button", { name: "吊销" })).toHaveLength(1);
  });

  it("已过期 key 显示「已过期」徽标且吊销按钮禁用，永不过期 key 明示", async () => {
    auth.user = userWith(API_KEY_ROLE);
    canned.apiKeys = [ACTIVE_KEY, EXPIRED_KEY, NEVER_KEY];
    renderProfilePage();

    await screen.findByText("临时对接");
    expect(screen.getByText("已过期")).toBeInTheDocument();
    expect(screen.getByText("永不过期")).toBeInTheDocument();

    const revokeButtons = screen.getAllByRole("button", { name: "吊销" });
    expect(revokeButtons).toHaveLength(3);
    expect(revokeButtons[1]).toBeDisabled();
    expect(revokeButtons[0]).toBeEnabled();
    expect(revokeButtons[2]).toBeEnabled();
  });

  it("存量旧 key 无 keyPreview 时前缀列显示 em dash 而非裸 sk_…", async () => {
    auth.user = userWith(API_KEY_ROLE);
    canned.apiKeys = [LEGACY_KEY];
    renderProfilePage();

    await screen.findByText("存量旧 key");
    expect(screen.getByTitle("存量旧 key 未记录明文预览")).toHaveTextContent("—");
    expect(screen.queryByText(/^sk_…$/)).not.toBeInTheDocument();
  });

  it("文档链接区指向 openapi.json、/docs/analytics、/api/v1/meta", async () => {
    auth.user = userWith(API_KEY_ROLE);
    renderProfilePage();

    await screen.findByText("API key");
    expect(screen.getByRole("link", { name: "OpenAPI 规格" })).toHaveAttribute(
      "href",
      "/api/v1/openapi.json",
    );
    expect(screen.getByRole("link", { name: "数据分析接入文档" })).toHaveAttribute(
      "href",
      "/docs/analytics",
    );
    expect(screen.getByRole("link", { name: "接口元信息" })).toHaveAttribute(
      "href",
      "/api/v1/meta",
    );
  });

  it("新建默认 90 天，提交换算为 expiresAt；明文仅创建成功时展示一次并支持复制", async () => {
    auth.user = userWith(API_KEY_ROLE);
    canned.created = {
      ...ACTIVE_KEY,
      id: "k9",
      name: "BI 拉数",
      key: "sk_plaintext_shown_once",
    };
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderProfilePage();

    fireEvent.click(await screen.findByRole("button", { name: "新建 API key" }));
    expect(screen.getByRole("combobox", { name: "有效期" })).toHaveTextContent("90 天");

    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "BI 拉数" } });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => {
      const input = calls.find((call) => call.path === "apiKey.create")?.input as
        | { name: string; expiresAt: string | null }
        | undefined;
      expect(input?.name).toBe("BI 拉数");
      const expiresAt = new Date(input?.expiresAt as string).getTime();
      const expected = Date.now() + 90 * 24 * 60 * 60 * 1000;
      expect(Math.abs(expiresAt - expected)).toBeLessThan(60 * 1000);
    });

    expect(await screen.findByDisplayValue("sk_plaintext_shown_once")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "复制" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("sk_plaintext_shown_once"));

    fireEvent.click(screen.getByRole("button", { name: "完成" }));
    await waitFor(() =>
      expect(screen.queryByDisplayValue("sk_plaintext_shown_once")).not.toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "新建 API key" }));
    expect(await screen.findByLabelText("名称")).toHaveValue("");
    expect(screen.queryByDisplayValue("sk_plaintext_shown_once")).not.toBeInTheDocument();
  });

  it("选择「永不过期」显示警示并提交 expiresAt null", async () => {
    auth.user = userWith(API_KEY_ROLE);
    canned.created = { ...NEVER_KEY, key: "sk_never_expires" };
    renderProfilePage();

    fireEvent.click(await screen.findByRole("button", { name: "新建 API key" }));
    const trigger = screen.getByRole("combobox", { name: "有效期" });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerId: 1 });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("option", { name: "永不过期" }));

    expect(screen.getByText(/永不过期的 key 泄露后长期有效/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "长期集成" } });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => {
      const input = calls.find((call) => call.path === "apiKey.create")?.input as
        | { name: string; expiresAt: string | null }
        | undefined;
      expect(input?.expiresAt).toBeNull();
    });
  });

  it("创建失败关闭后重开，错误提示不残留", async () => {
    auth.user = userWith(API_KEY_ROLE);
    serverError = {
      path: "apiKey.create",
      message: "名称已被占用",
      code: "CONFLICT",
      httpStatus: 409,
    };
    renderProfilePage();

    fireEvent.click(await screen.findByRole("button", { name: "新建 API key" }));
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "BI" } });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));
    await screen.findByText("创建失败");
    expect(screen.getByText("名称已被占用")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    fireEvent.click(await screen.findByRole("button", { name: "新建 API key" }));

    expect(screen.queryByText("创建失败")).not.toBeInTheDocument();
    expect(screen.queryByText("名称已被占用")).not.toBeInTheDocument();
  });

  it("吊销需确认，确认后调 apiKey.revoke 并刷新列表", async () => {
    auth.user = userWith(API_KEY_ROLE);
    canned.apiKeys = [ACTIVE_KEY, REVOKED_KEY];
    renderProfilePage();
    await screen.findByText("报表同步");

    fireEvent.click(screen.getByRole("button", { name: "吊销" }));
    expect(calls.some((call) => call.path === "apiKey.revoke")).toBe(false);

    await screen.findByRole("heading", { name: "吊销 API key" });
    fireEvent.click(screen.getByRole("button", { name: "确认吊销" }));

    await waitFor(() =>
      expect(calls.find((call) => call.path === "apiKey.revoke")?.input).toEqual({ id: "k1" }),
    );
    await waitFor(() =>
      expect(calls.filter((call) => call.path === "apiKey.list").length).toBeGreaterThanOrEqual(2),
    );
  });
});
