import type { Page } from "playwright";

export default async function prepare(page: Page): Promise<void> {
  await page.goto("/tickets/clchangelogrefund0001", { waitUntil: "networkidle" });
  await page.getByText("退费信息").waitFor();
}
