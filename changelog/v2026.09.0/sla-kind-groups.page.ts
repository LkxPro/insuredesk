import type { Page } from "playwright";

export default async function prepare(page: Page): Promise<void> {
  await page.getByRole("heading", { name: "退费异常" }).waitFor();
  await page.evaluate(() => {
    document.body.style.zoom = "0.62";
  });
  await page.waitForTimeout(300);
}
