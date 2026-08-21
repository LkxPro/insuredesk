import type { AppRouter } from "@insuredesk/api";
import type { inferRouterOutputs } from "@trpc/server";

export type TicketDetail = NonNullable<inferRouterOutputs<AppRouter>["ticket"]["detail"]>;
