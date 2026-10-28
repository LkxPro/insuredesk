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

const authState = vi.hoisted(() => ({
  user: null as AuthUser | null,
  isLoading: false,
}));

// vitest refuses to export hoisted declarations, hence the alias indirection.

export const auth = authState;

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

export const calls: Array<{ path: string; input: unknown }> = [];

export function callsTo(path: string) {
  return calls.filter((call) => call.path === path);
}

export type TrpcOverrides = Record<string, unknown>;

function defaultData(path: string): unknown {
  if (path === "notification.list") {
    return { items: [], unreadCount: 0, todo: { items: [], count: 0 } };
  }
  if (path.endsWith(".filterOptions") || path.endsWith(".options")) {
    return [];
  }
  if (path === "ticket.assigneeOptions" || path === "ticket.creatorOptions") {
    return [];
  }
  if (path === "ticket.findDuplicates" || path === "externalTicket.findRelated") {
    return [];
  }
  return { items: [], total: 0, page: 1, pageSize: 20 };
}

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
      try {
        const data =
          override === undefined
            ? defaultData(path)
            : typeof override === "function"
              ? override(procedureInput)
              : override;
        return { result: { data } };
      } catch (error) {
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

export const restFetch = vi.fn();

export function renderApp(options: {
  path: string;
  role?: TestRole;
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
