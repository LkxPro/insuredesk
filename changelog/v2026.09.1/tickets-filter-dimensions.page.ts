import type { Page } from "playwright";

export default async function prepare(page: Page): Promise<void> {
  await page.goto("/tickets?firstResponse=pending&slaPolicyId=none", {
    waitUntil: "networkidle",
  });
  await page.getByRole("button", { name: "责任人", exact: true }).waitFor();
}
