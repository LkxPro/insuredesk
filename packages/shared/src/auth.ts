import { z } from "zod";

/**
 * Login request contract, shared by the API (request-body validation in
 * server.ts) and the web login form (react-hook-form resolver) — one schema,
 * both ends.
 */
export const loginBodySchema = z.object({
  username: z.string().min(1, "请输入用户名"),
  password: z.string().min(1, "请输入密码"),
});

export type LoginBody = z.infer<typeof loginBodySchema>;
