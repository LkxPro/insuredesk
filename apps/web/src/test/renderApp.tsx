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

// The ToastHost outlet lives in App.tsx, outside this render tree — spy on the
// imperative facade instead of hunting for rendered toast text. The base fn
// covers plain toast(...) calls (NotificationBell arrivals).
const spies = vi.hoisted(() =>
  Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
);

export const toastSpies = spies;

vi.mock("@/lib/toast", () => ({ toast: spies }));

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

export function userWith(role: TestRole, isExternal = false): AuthUser {
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
    isExternal,
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
  if (path.endsWith(".filterOptions") || path.endsWith(".options")) {
    return [];
  }
  // 详情页条幅会查 ticket.findDuplicates；空数组 = 无命中，条幅不渲染
  if (path === "ticket.findDuplicates") {
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
      // A resolver that throws stands in for a server-side failure: the batch
      // item becomes an error envelope, so the client surfaces it the way it
      // would a real TRPCError instead of the request hanging.
      try {
        const data =
          override === undefined
            ? defaultData(path)
            : typeof override === "function"
              ? override(procedureInput)
              : override;
        return { result: { data } };
      } catch (error) {
        // 抛出的 Error 可带 trpcCode（如 "CONFLICT"）来指定错误码，缺省 BAD_REQUEST
        const trpcCode = (error as { trpcCode?: unknown }).trpcCode;
        return {
          error: {
            message: error instanceof Error ? error.message : String(error),
            code: -32600,
            data: {
              code: typeof trpcCode === "string" ? trpcCode : "BAD_REQUEST",
              httpStatus: trpcCode === "CONFLICT" ? 409 : 400,
              path,
            },
          },
        };
      }
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
  /** true = 外部账号，与 auth.me 的语义一致。 */
  isExternal?: boolean;
  trpc?: TrpcOverrides;
}) {
  if (options.role) {
    auth.user = userWith(options.role, options.isExternal ?? false);
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
  toastSpies.mockReset();
  toastSpies.error.mockReset();
  toastSpies.success.mockReset();
  toastSpies.warning.mockReset();
  toastSpies.info.mockReset();
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
