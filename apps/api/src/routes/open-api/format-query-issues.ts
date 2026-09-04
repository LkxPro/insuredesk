import type { z } from "zod";

// 顶层错误（如 strict 拒绝未知参数名）path 为空，裸拼会出 "…: : Unrecognized key" 双冒号。
export function formatQueryIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}
