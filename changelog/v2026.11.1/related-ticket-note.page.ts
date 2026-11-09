import type { Page } from "playwright";

export default async function prepare(page: Page): Promise<void> {
  await page.getByRole("textbox", { name: "保单号", exact: true }).fill("POL20261109001");
  await page.getByRole("button", { name: "WO900111", exact: true }).click();
  await page
    .getByText("客户再次来电，已补充缴费凭证，请原负责人继续核实。", { exact: true })
    .waitFor();
  await page.getByLabel("补充备注（仅内部可见）").fill("客户希望明日上午收到核实结果。");
  await page.mouse.click(1100, 65);
}
