import type { Page } from "playwright";

export default async function prepare(page: Page): Promise<void> {
  const checkbox = page.getByRole("checkbox", { name: "无保单号", exact: true });
  await checkbox.check();
  await checkbox.scrollIntoViewIfNeeded();
}
