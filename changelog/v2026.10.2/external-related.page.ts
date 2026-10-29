import type { Page } from "playwright";
import { loginExternal } from "./external-login.ts";

export default async function prepare(page: Page): Promise<void> {
  await loginExternal(page);
  await page.goto("/external-tickets/clchangelog102ext0", { waitUntil: "networkidle" });
  await page.getByText("该客户另有 2 个工单").waitFor();
  await page.getByRole("button", { name: "展开其余 1 个工单" }).click();
  await page.getByText("已联系客户补充保单信息。").first().waitFor();
}
