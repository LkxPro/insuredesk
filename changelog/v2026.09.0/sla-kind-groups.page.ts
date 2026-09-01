import type { Page } from "playwright";

export default async function prepare(page: Page): Promise<void> {
  await page.getByRole("heading", { name: "退费异常" }).waitFor();
  await page.evaluate(() => {
    const content = document.querySelector("main.overflow-y-auto")?.firstElementChild;
    if (content instanceof HTMLElement) content.style.zoom = "0.58";
  });
  await page.waitForTimeout(300);
}
