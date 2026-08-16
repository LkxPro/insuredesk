import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildChangelogReleases,
  isChangelogUnread,
  lastSeenChangelogVersion,
} from "@/lib/changelog";
import { ChangelogPage } from "./ChangelogPage";

const fixtureRaw = import.meta.glob<string>("../../lib/__fixtures__/changelog/*.yaml", {
  eager: true,
  query: "?raw",
  import: "default",
});
const fixtureScreenshots = import.meta.glob<string>("../../lib/__fixtures__/changelog/*/*.png", {
  eager: true,
  query: "?url",
  import: "default",
});

const releases = buildChangelogReleases(fixtureRaw, fixtureScreenshots);

function renderPage(props: Parameters<typeof ChangelogPage>[0] = { releases }) {
  return render(
    <MemoryRouter>
      <ChangelogPage {...props} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("ChangelogPage", () => {
  it("按版本倒序渲染，每条目显示分类徽章 + user 文案", () => {
    renderPage();

    const sections = screen.getAllByRole("region");
    expect(sections).toHaveLength(2);
    expect(within(sections[0] as HTMLElement).getByRole("heading", { level: 2 })).toHaveTextContent(
      "v2026.08.10",
    );
    expect(within(sections[1] as HTMLElement).getByRole("heading", { level: 2 })).toHaveTextContent(
      "v2026.08.9",
    );

    const latest = within(sections[0] as HTMLElement);
    expect(latest.getByText("新增")).toBeInTheDocument();
    expect(latest.getByText("改进")).toBeInTheDocument();
    expect(latest.getByText("工单列表支持按渠道筛选")).toBeInTheDocument();
    expect(latest.getByText("排班页加载更快")).toBeInTheDocument();
  });

  it("不渲染 category=内部 的条目", () => {
    renderPage();

    expect(screen.queryByText("内部")).toBeNull();
    expect(screen.queryByText("升级依赖")).toBeNull();
  });

  it("渲染条目截图与相关页面链接", () => {
    renderPage();

    const shot = screen.getByRole("img", { name: "工单列表支持按渠道筛选" });
    expect(shot.getAttribute("src")).toContain("shot.png");
    expect(screen.getByRole("link", { name: "/tickets" })).toHaveAttribute("href", "/tickets");
  });

  it("进入页面后把最新版本标记为已读（红点消除）", () => {
    renderPage();

    const lastSeen = lastSeenChangelogVersion();
    expect(lastSeen).toBe("v2026.08.10");
    expect(isChangelogUnread(releases[0]?.version ?? null, lastSeen)).toBe(false);
  });

  it("没有任何 changelog 时展示空态", () => {
    renderPage({ releases: [] });

    expect(screen.getByRole("heading", { name: "更新日志" })).toBeInTheDocument();
    expect(screen.getByText("暂无更新记录")).toBeInTheDocument();
    expect(lastSeenChangelogVersion()).toBeNull();
  });
});
