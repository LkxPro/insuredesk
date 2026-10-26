import type { Page } from "playwright";

async function pickRegion(page: Page, id: string, query: string, option: string): Promise<void> {
  const input = page.locator(`#${id}`);
  await input.click();
  await input.fill(query);
  await page.getByRole("option", { name: option, exact: true }).click();
}

export default async function prepare(page: Page): Promise<void> {
  const province = page.locator("#address");
  await province.waitFor({ state: "visible" });
  // 区划树懒加载完成前下拉为 disabled
  await page.waitForFunction(
    () => !(document.getElementById("address") as HTMLInputElement | null)?.disabled,
  );
  await province.scrollIntoViewIfNeeded();
  await pickRegion(page, "address", "广东", "广东省");
  await pickRegion(page, "address-1", "深圳", "深圳市");
  await pickRegion(page, "address-2", "南山", "南山区");
  // 等末级下拉弹层的关闭动画结束，否则截图带残影
  await page.getByRole("listbox").waitFor({ state: "detached" });
  await page.waitForTimeout(300);
  await province.scrollIntoViewIfNeeded();
}
