import { z } from "zod";

/**
 * Contract for the `health` procedure. Shared verbatim between the tRPC server
 * (which produces it) and the web client (which consumes it), so the shape is
 * checked at compile time on both ends — the walking skeleton's proof that the
 * shared package wires front and back together.
 */
export const healthStatusSchema = z.object({
  status: z.literal("ok"),
  service: z.string().min(1),
  /** ISO-8601 timestamp, UTC. */
  timestamp: z.string().datetime(),
  /** Process uptime in seconds. */
  uptimeSeconds: z.number().nonnegative(),
});

export type HealthStatus = z.infer<typeof healthStatusSchema>;
