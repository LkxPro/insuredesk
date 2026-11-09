import type { Page } from "playwright";

export default async function prepare(page: Page): Promise<void> {
  const policy = page.getByRole("textbox", { name: "保单号", exact: true });
  await policy.fill("POL20261109002");
  await policy.scrollIntoViewIfNeeded();
  await page.getByLabel("项目（保司）", { exact: true }).fill("安心健康险");
  await policy.scrollIntoViewIfNeeded();
  await page.mouse.click(950, 100);
}
