import type { Page } from "playwright";

export default async function prepare(page: Page): Promise<void> {
  await page.getByText("运营周报拉数").waitFor();
  await page
    .getByRole("button", { name: "新建 API key" })
    .evaluate((el) => el.scrollIntoView({ block: "start" }));
}
