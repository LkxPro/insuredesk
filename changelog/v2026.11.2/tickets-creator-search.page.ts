import type { Page } from "playwright";

export default async function prepare(page: Page): Promise<void> {
  await page.goto("/tickets?q=演示", { waitUntil: "networkidle" });
  const toggle = page.getByRole("switch", { name: "最新消息" });
  if ((await toggle.getAttribute("aria-checked")) === "true") await toggle.click();
  await page.getByRole("button", { name: "创建人", exact: true }).click();
  await page.getByRole("searchbox", { name: "搜索创建人" }).fill("林");
  await page.getByText("林悦", { exact: true }).last().waitFor();
}
