import type { Page } from "playwright";
import { panMap } from "./ticket-map.page.ts";

export default async function prepare(page: Page): Promise<void> {
  const search = page.getByRole("combobox", { name: "搜索地区" });
  await search.click();
  await search.fill("南京江宁");
  await page.getByRole("option", { name: "江苏省 南京市 江宁区", exact: true }).click();
  await page.getByRole("heading", { name: "工单地图 · 江苏省 · 南京市" }).waitFor();
  await page.getByRole("listbox").waitFor({ state: "detached" });
  await page.getByRole("button", { name: "显示区名" }).click();
  await page.getByRole("button", { name: "隐藏区名" }).waitFor();
  await page.waitForTimeout(300);
  await panMap(page);
}
