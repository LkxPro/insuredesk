import type { Page } from "playwright";

// 截图视口 1280 宽时排名卡片盖住地图西部，拖动地图避开卡片；拖完移出画布，免得悬浮提示入镜
export async function panMap(page: Page): Promise<void> {
  const box = await page.locator("canvas").first().boundingBox();
  if (!box) throw new Error("地图画布未渲染");
  const x = box.x + box.width * 0.6;
  const y = box.y + box.height * 0.7;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 200, y, { steps: 10 });
  await page.mouse.up();
  await page.mouse.move(box.x + box.width / 2, 1);
  await page.waitForTimeout(500);
}

export default async function prepare(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^第 1 名 江苏省/ }).waitFor();
  await panMap(page);
}
