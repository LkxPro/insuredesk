import type { Page } from "playwright";

export default async function prepare(page: Page): Promise<void> {
  await page.goto("/tickets/release113-hongfan-no-refund", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "完结工单", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "完结状态" }).click();
  await page.getByRole("option", { name: "未退费", exact: true }).click();
  await dialog.getByLabel("完结备注").fill("客户确认保留保障，撤回退费申请，本次未退费。");
  await dialog.getByText("本次为未退费结案，不会回传弘樊系统。").waitFor();
}
