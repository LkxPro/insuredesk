import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastHost } from "@/components/ToastHost";
import { toast } from "@/lib/toast";
import { toastStore } from "@/lib/toast-store";

/**
 * 胶囊队列轻提示：顶部居中、逐条带关闭键；默认 4 秒自动消失（push 即启动
 * 各自计时），duration: "sticky" 或自定义毫秒数可覆盖；多条折叠为「N 条」
 * 徽标可展开；带 onClick 的条目点击本体触发并随之关闭。
 * Store 是全局单例，用例间清空（afterEach 同时清掉未燃的计时器）。
 */

afterEach(() => {
  toastStore.clear();
});

describe("ToastHost", () => {
  it("renders nothing when the queue is empty", () => {
    const { container } = render(<ToastHost />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the latest toast in a pill with its description", async () => {
    render(<ToastHost />);
    toast.success("工单 WO100001 已创建", { description: "分配给 李主管" });

    expect(await screen.findByText("工单 WO100001 已创建")).toBeInTheDocument();
    expect(screen.getByText(/分配给 李主管/)).toBeInTheDocument();
  });

  it("closes only the dismissed item via 关闭键", async () => {
    render(<ToastHost />);
    toast.success("第一条");
    toast.error("第二条");

    await screen.findByText("第二条");
    fireEvent.click(screen.getByRole("button", { name: "关闭通知" }));
    expect(screen.queryByText("第二条")).not.toBeInTheDocument();

    // 关掉最新后露出上一条
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

describe("ToastHost 自动消失", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("dismisses a default toast after 4 seconds", () => {
    render(<ToastHost />);
    act(() => {
      toast.success("已保存");
    });
    expect(screen.getByText("已保存")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3_999);
    });
    expect(screen.getByText("已保存")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText("已保存")).not.toBeInTheDocument();
  });

  it("keeps a sticky toast until manual close", () => {
    render(<ToastHost />);
    act(() => {
      toast.warning("当前无在岗人员，2 个工单未分配，请手动处理", { duration: "sticky" });
    });

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText(/当前无在岗人员/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "关闭通知" }));
    expect(screen.queryByText(/当前无在岗人员/)).not.toBeInTheDocument();
  });

  it("honours a custom duration", () => {
    render(<ToastHost />);
    act(() => {
      toast("你有 1 条新通知", { duration: 15_000 });
    });

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByText("你有 1 条新通知")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(screen.queryByText("你有 1 条新通知")).not.toBeInTheDocument();
  });

  it("starts each item's timer at push time, even while collapsed", () => {
    render(<ToastHost />);
    act(() => {
      toast.success("先入队的");
    });
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    act(() => {
      toast.success("后入队的");
    });
    act(() => {
      vi.advanceTimersByTime(2_000);
    });

    // 先入队的到点消失（即使一直折叠在徽标里），后入队的还剩 2 秒
    expect(screen.queryByText("先入队的")).not.toBeInTheDocument();
    expect(screen.getByText("后入队的")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /条/ })).not.toBeInTheDocument();
  });
});
