import type { Page } from "playwright";

export async function loginExternal(page: Page): Promise<void> {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("用户名").fill("changelog102-0");
  await page.getByLabel("密码").fill("password123");
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}
