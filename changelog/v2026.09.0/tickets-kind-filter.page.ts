import type { Page } from "playwright";

export default async function prepare(page: Page): Promise<void> {
  await page.getByRole("button", { name: "种类", exact: true }).click();
  await page
    .locator('[data-slot="popover-content"]')
    .getByText("退费异常", { exact: true })
    .waitFor();
  await page.waitForTimeout(300);
}
