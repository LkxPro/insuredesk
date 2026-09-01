import type { Page } from "playwright";

export default async function prepare(page: Page): Promise<void> {
  await page.getByRole("button", { name: "管理工单种类" }).click();
  await page.getByRole("dialog", { name: "工单种类" }).waitFor();
  await page.getByRole("cell", { name: "退费异常", exact: true }).waitFor();
  await page.waitForTimeout(500);
}
