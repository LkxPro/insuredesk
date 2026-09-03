import type { Page } from "playwright";

export default async function prepare(page: Page): Promise<void> {
  await page.goto("/tickets/clchangelogrefund0003", { waitUntil: "networkidle" });
  await page.getByText("客户与补偿").waitFor();
}
