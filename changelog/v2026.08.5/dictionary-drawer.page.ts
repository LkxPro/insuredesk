import type { Page } from "playwright";

export default async function prepare(page: Page): Promise<void> {
  await page.getByRole("button", { name: "管理客诉类别" }).click();
  await page.getByRole("dialog", { name: "客诉类别" }).waitFor();
  await page.getByRole("button", { name: "新增类别" }).waitFor();
  // 等抽屉滑入动画落定
  await page.waitForTimeout(500);
}
