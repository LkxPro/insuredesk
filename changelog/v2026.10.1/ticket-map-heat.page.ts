import type { Page } from "playwright";

// 排名卡片展开时盖住地图左下角的色阶图例
export default async function prepare(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^第 1 名 广东省/ }).waitFor();
  await page.getByRole("button", { name: "收起" }).click();
  await page.getByRole("button", { name: "展开" }).waitFor();
  await page.mouse.move(640, 1);
  await page.waitForTimeout(500);
}
