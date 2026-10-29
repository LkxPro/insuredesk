import type { Page } from "playwright";
import { loginExternal } from "./external-login.ts";

export default async function prepare(page: Page): Promise<void> {
  await loginExternal(page);
  await page.goto("/external-tickets", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "新建工单" }).click();
  await page.getByLabel("投保人手机号（必填）").fill("13800001028");
  await page.getByText("发现 3 个关联工单").waitFor();
}
