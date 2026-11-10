import type { Page } from "playwright";

export default async function prepare(page: Page): Promise<void> {
  await page.goto("/tickets?q=演示", { waitUntil: "networkidle" });
  const toggle = page.getByRole("switch", { name: "最新消息" });
  if ((await toggle.getAttribute("aria-checked")) !== "true") await toggle.click();
  await page
    .getByRole("link", { name: "已核实退费进度，明日上午回访客户。", exact: true })
    .first()
    .hover();
  await page.getByRole("region", { name: "沟通记录" }).waitFor();
  await page.getByText("客户希望确认退费进度，请协助核实。", { exact: true }).waitFor();
}
