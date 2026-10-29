import type { Page } from "playwright";

export default async function prepare(page: Page): Promise<void> {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("用户名").fill(process.env.SCREENSHOT_USERNAME ?? "admin");
  await page.getByLabel("密码").fill(process.env.SCREENSHOT_PASSWORD ?? "password123");
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  await page.goto("/tickets?q=发版演示&creatorId=clchangelog102user0,clchangelog102user2", {
    waitUntil: "networkidle",
  });
  await page.getByRole("button", { name: "创建人", exact: true }).click();
  await page.getByRole("checkbox", { name: "历史客服（已停用）", exact: true }).waitFor();
  await page.locator('[data-slot="popover-content"]').evaluate(async (element) => {
    await Promise.all(
      element.getAnimations({ subtree: true }).map((animation) => animation.finished),
    );
  });
  await page.waitForLoadState("networkidle");
}
