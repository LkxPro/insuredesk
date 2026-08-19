import type { Page } from "playwright";

export default async function prepare(page: Page): Promise<void> {
  const input = page.locator("#complaintReceiveChannelId");
  await input.click();
  await input.fill("dfdd");
  await page.getByText("东方大地").first().waitFor();
}
