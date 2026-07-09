import type { AppRouter } from "@insuredesk/api";
import { createTRPCReact } from "@trpc/react-query";

/**
 * Typed tRPC React hooks. `AppRouter` is imported as a type from the api
 * package, so the entire client surface is checked against the server's
 * procedures at compile time — zero codegen, zero drift.
 */
export const trpc = createTRPCReact<AppRouter>();
