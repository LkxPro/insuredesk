import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastHost } from "@/components/ToastHost";
import { toast } from "@/lib/toast";
import { toastStore } from "@/lib/toast-store";

/**
 * 胶囊队列轻提示：顶部居中、不自动消失、关闭键逐条关闭；多条折叠为
 * 「N 条」徽标可展开；带 onClick 的条目点击本体触发并随之关闭。
 * Store 是全局单例，每个用例前清空。
 */

beforeEach(() => {
  toastStore.clear();
});

describe("ToastHost", () => {
  it("renders nothing when the queue is empty", () => {
    const { container } = render(<ToastHost />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the latest toast in a pill with its description, and never auto-dismisses", async () => {
    render(<ToastHost />);
    toast.success("工单 WO100001 已创建", { description: "分配给 李主管" });

    expect(await screen.findByText("工单 WO100001 已创建")).toBeInTheDocument();
    expect(screen.getByText(/分配给 李主管/)).toBeInTheDocument();

    // 不自动消失：没有任何定时器，等待一轮后仍在
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByText("工单 WO100001 已创建")).toBeInTheDocument();
  });

  it("closes only the dismissed item via 关闭键", async () => {
    render(<ToastHost />);
    toast.success("第一条");
    toast.error("第二条");

    await screen.findByText("第二条");
    fireEvent.click(screen.getByRole("button", { name: "关闭通知" }));
    expect(screen.queryByText("第二条")).not.toBeInTheDocument();

    // 关掉最新后露出上一条，仍不自动消失
    expect(await screen.findByText("第一条")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭通知" }));
    expect(screen.queryByText("第一条")).not.toBeInTheDocument();
  });

  it("collapses multiple toasts into a count badge that expands the queue", async () => {
    render(<ToastHost />);
    toast.success("最早的");
    toast.warning("中间的");
    toast.error("最新的");

    // 胶囊只显示最新一条，其余折叠进徽标
    expect(await screen.findByText("最新的")).toBeInTheDocument();
    expect(screen.queryByText("最早的")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /3 条/ }));
    const queue = await screen.findByRole("list", { name: "待处理通知" });
    expect(within(queue).getByText("最早的")).toBeInTheDocument();
    expect(within(queue).getByText("中间的")).toBeInTheDocument();

    // 展开态逐条关闭：第一行是最新一条
    fireEvent.click(within(queue).getAllByRole("button", { name: "关闭通知" })[0] as HTMLElement);
    expect(within(queue).queryByText("最新的")).not.toBeInTheDocument();
    expect(within(queue).getByText("中间的")).toBeInTheDocument();
    // 关掉一条后徽标计数随之收缩
    expect(screen.getByRole("button", { name: /2 条/ })).toBeInTheDocument();
  });

  it("runs onClick and dismisses when the item body is clicked", async () => {
    const onClick = vi.fn();
    render(<ToastHost />);
    toast("你有 1 条新通知", { onClick });

    fireEvent.click(await screen.findByText("你有 1 条新通知"));
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.queryByText("你有 1 条新通知")).not.toBeInTheDocument();
  });

  it("drops the oldest beyond the queue cap", async () => {
    render(<ToastHost />);
    for (let i = 1; i <= 7; i += 1) {
      toast.info(`第 ${i} 条`);
    }

    expect(await screen.findByText("第 7 条")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /6 条/ }));
    expect(screen.queryByText("第 1 条")).not.toBeInTheDocument();
    expect(screen.getByText("第 2 条")).toBeInTheDocument();
  });
});
