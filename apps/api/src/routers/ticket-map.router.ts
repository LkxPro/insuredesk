import { ticketMapPointsInputSchema } from "@insuredesk/shared";
import { systemClock } from "../clock.ts";
import { prisma } from "../db.ts";
import { getTicketMapLocations } from "../services/ticket-map.service.ts";
import { requirePermission, router } from "../trpc.ts";

const deps = { prisma, clock: systemClock };

export const ticketMapRouter = router({
  points: requirePermission("ticket_map.view")
    .input(ticketMapPointsInputSchema)
    .query(({ ctx, input }) => getTicketMapLocations(deps, ctx.user, input)),
});
