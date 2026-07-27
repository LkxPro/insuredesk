import type { Permission } from "@insuredesk/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { httpBatchLink } from "@trpc/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, vi } from "vitest";
import { AppRoutes } from "@/AppRoutes";
import { ThemeProvider } from "@/components/ThemeProvider";
import type { AuthUser } from "@/contexts/AuthContext";
import { trpc } from "@/lib/trpc";

/**
 * Shared page-test harness: auth seam mock, user factory, provider tree,
 * toast spies, and a faked tRPC fetch in one import. A test file declares
 * only the procedures it cares about via `renderApp({ path, role, trpc })`;
 * every other procedure gets an empty default (empty list, zero count).
 *
 * Import this module FIRST in the test file: its vi.mock calls register when
 * the module evaluates, and app modules imported later must see the mocks.
 */

const authState = vi.hoisted(() => ({
  user: null as AuthUser | null,
  isLoading: false,
}));

// vitest refuses to export hoisted declarations, hence the alias indirection.

/** Auth seam state: files set a default user in beforeEach, tests override per case. */
export const auth = authState;

// The Toaster outlet lives in main.tsx, outside this render tree — spy on the
// imperative API instead of hunting for rendered toast text.
const spies = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
}));

export const toastSpies = spies;

vi.mock("sonner", () => ({ toast: spies }));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: authState.user,
    isLoading: authState.isLoading,
    hasPermission: (permission: Permission) =>
      authState.user?.permissions.includes(permission) ?? false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

export type TestRole = { name: string; permissions: readonly Permission[] };

export function userWith(role: TestRole, externalOrgId: string | null = null): AuthUser {
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
    externalOrgId,
  };
}

/** Every decoded tRPC call, in order. */
export const calls: Array<{ path: string; input: unknown }> = [];

/** Calls to one procedure, in order. */
export function callsTo(path: string) {
  return calls.filter((call) => call.path === path);
}

/** path → canned data, or a resolver `(input) => data` for input-dependent replies. */
export type TrpcOverrides = Record<string, unknown>;

function defaultData(path: string): unknown {
  // The AppLayout bell polls notification.list in the same batch; an empty
  // inbox keeps tests focused on their own procedures.
  if (path === "notification.list") {
    return { items: [], unreadCount: 0, todo: { items: [], count: 0 } };
  }
  if (path.endsWith(".filterOptions")) {
    return [];
  }
  return { items: [], total: 0, page: 1, pageSize: 20 };
}

/** Batched tRPC calls arrive as GET with `input` in the URL, POST with it as the body. */
function fakeTrpcFetch(overrides: TrpcOverrides) {
  return (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const paths = (url.pathname.split("/api/trpc/")[1] ?? "").split(",");
    const raw = init?.method === "POST" ? String(init.body) : url.searchParams.get("input");
    const batch = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const body = paths.map((path, index) => {
      const procedureInput = batch[String(index)];
      calls.push({ path, input: procedureInput });
      const override = overrides[path];
      const data =
        override === undefined
          ? defaultData(path)
          : typeof override === "function"
            ? override(procedureInput)
            : override;
      return { result: { data } };
    });
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  };
}

// Non-tRPC requests (export download, import template/upload) call the global
// fetch; the tRPC link gets its own injected one, so the two never cross.
export const restFetch = vi.fn();

export function renderApp(options: {
  path: string;
  role?: TestRole;
  /** 非空 = 外部账号，与 auth.me 的语义一致。 */
  externalOrgId?: string | null;
  trpc?: TrpcOverrides;
}) {
  if (options.role) {
    auth.user = userWith(options.role, options.externalOrgId ?? null);
  }
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const trpcClient = trpc.createClient({
    links: [
      httpBatchLink({ url: "http://localhost/api/trpc", fetch: fakeTrpcFetch(options.trpc ?? {}) }),
    ],
  });

  return render(
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <MemoryRouter initialEntries={[options.path]}>
            <AppRoutes />
          </MemoryRouter>
        </ThemeProvider>
      </QueryClientProvider>
    </trpc.Provider>,
  );
}

beforeEach(() => {
  auth.user = null;
  auth.isLoading = false;
  calls.length = 0;
  toastSpies.error.mockReset();
  toastSpies.success.mockReset();
  toastSpies.warning.mockReset();
  restFetch.mockReset();
  vi.stubGlobal("fetch", restFetch);
  // jsdom has no object-URL implementation; download paths need both ends
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
