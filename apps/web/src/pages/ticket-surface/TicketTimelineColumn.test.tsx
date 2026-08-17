import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TicketTimelineColumn, type TimelineLog } from "./TicketTimelineColumn";

/**
 * 滚动行为（贴底/跳转钮）依赖真实视口高度，jsdom 里不可断言，不在此覆盖。
 */

function log(overrides: Partial<TimelineLog> & Pick<TimelineLog, "id" | "action">): TimelineLog {
  return {
    operatorName: "张三",
    at: "2026-07-09T02:00:00.000Z",
    remark: null,
    ...overrides,
  };
}

describe("排序", () => {
  it("倒序渲染：数组末尾（最新）的条目排在最上", () => {
    render(
      <TicketTimelineColumn
        logs={[
          log({ id: "l1", action: "comment", remark: "较早的跟进" }),
          log({ id: "l2", action: "external_note", remark: "最新的留言" }),
        ]}
      />,
    );

    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("最新的留言");
    expect(items[1]).toHaveTextContent("较早的跟进");
  });
});

describe("沟通气泡", () => {
  it("留言/跟进带类型徽章与备注气泡；对方（默认 external_note）落左侧带头像", () => {
    render(
      <TicketTimelineColumn
        logs={[
          log({
            id: "l1",
            action: "external_note",
            operatorName: "王五",
            remark: "理赔款何时到？",
          }),
          log({ id: "l2", action: "comment", remark: "已回电客户，承诺 T+1 反馈" }),
        ]}
      />,
    );

    const incomingLi = screen.getByText("外部留言").closest("li");
    const outgoingLi = screen.getByText("跟进记录").closest("li");
    expect(incomingLi).not.toBeNull();
    expect(outgoingLi).not.toBeNull();
    // 对方在左（无 justify-end）且有头像（姓名首字）；我方在右、无头像
    expect(incomingLi?.className).not.toContain("justify-end");
    expect(incomingLi).toHaveTextContent("王");
    expect(incomingLi).toHaveTextContent("理赔款何时到？");
    expect(outgoingLi?.className).toContain("justify-end");
    expect(outgoingLi).toHaveTextContent("已回电客户，承诺 T+1 反馈");
  });

  it('incomingActions=["comment"]（外部端视角）左右互换', () => {
    render(
      <TicketTimelineColumn
        incomingActions={["comment"]}
        logs={[
          log({ id: "l1", action: "comment", operatorName: "李客服", remark: "已加急处理" }),
          log({ id: "l2", action: "external_note", remark: "好的，谢谢" }),
        ]}
      />,
    );

    expect(screen.getByText("跟进记录").closest("li")?.className).not.toContain("justify-end");
    expect(screen.getByText("外部留言").closest("li")?.className).toContain("justify-end");
  });

  it("备注为空时气泡兜底文案", () => {
    render(<TicketTimelineColumn logs={[log({ id: "l1", action: "external_note" })]} />);

    expect(screen.getByText("（无留言内容）")).toBeInTheDocument();
  });
});

describe("系统动作", () => {
  it("status_change 不渲染；其余系统动作收成一行", () => {
    render(
      <TicketTimelineColumn
        logs={[
          log({ id: "l1", action: "create", remark: "创建工单" }),
          log({ id: "l2", action: "status_change", remark: "确认完结" }),
          log({ id: "l3", action: "assign" }),
        ]}
      />,
    );

    expect(screen.queryByText(/状态变更/)).not.toBeInTheDocument();
    expect(screen.getByText(/创建工单/)).toBeInTheDocument();
    expect(screen.getByText(/分配责任人/)).toBeInTheDocument();
  });
});

describe("完结里程碑", () => {
  it("细线一行装齐 状态值·人·时间，备注裸文跟随", () => {
    render(
      <TicketTimelineColumn
        completionStatus="已协商解决"
        logs={[log({ id: "l1", action: "resolve", remark: "客户认可赔付方案\n已短信确认" })]}
      />,
    );

    // 状态值在标题行；无独立的完结状态字段行
    expect(screen.getByText(/已协商解决/)).toBeInTheDocument();
    expect(screen.queryByText("完结状态：")).not.toBeInTheDocument();
    expect(screen.getByText(/客户认可赔付方案/)).toBeInTheDocument();
  });

  it("无完结状态（未传 prop）时标题行只有「完结 · 人 · 时间」", () => {
    render(
      <TicketTimelineColumn
        logs={[log({ id: "l1", action: "resolve", remark: "客户无进一步诉求" })]}
      />,
    );

    expect(screen.getByText(/完结/)).toBeInTheDocument();
    expect(screen.queryByText("完结状态：")).not.toBeInTheDocument();
  });

  it("resolve + status_change 的留痕对只呈现一个完结条目", () => {
    render(
      <TicketTimelineColumn
        logs={[
          log({ id: "l1", action: "resolve", remark: "客户已认可" }),
          log({ id: "l2", action: "status_change", remark: "确认完结" }),
        ]}
      />,
    );

    // status_change 不渲染，它的备注文案不出现
    expect(screen.queryByText("确认完结")).not.toBeInTheDocument();
    expect(screen.getByText(/客户已认可/)).toBeInTheDocument();
  });
});

describe("编辑展开", () => {
  const editLog = log({
    id: "l1",
    action: "edit",
    remark: "客户姓名: 王小明→王小二；联系电话: （空）→13800000002",
  });

  it("默认收起为可点的一行，点开看逐字段 旧值→新值，再点收起", () => {
    render(<TicketTimelineColumn logs={[editLog]} />);

    const toggle = screen.getByRole("button", { name: /编辑工单/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("王小二")).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("客户姓名")).toBeInTheDocument();
    expect(screen.getByText("王小明")).toBeInTheDocument();
    expect(screen.getByText("王小二")).toBeInTheDocument();
    expect(screen.getByText("（空）")).toBeInTheDocument();
    expect(screen.getByText("13800000002")).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.queryByText("王小二")).not.toBeInTheDocument();
  });

  it("解析失败的段整段原文兜底", () => {
    render(
      <TicketTimelineColumn logs={[log({ id: "l1", action: "edit", remark: "无分隔符的备注" })]} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /编辑工单/ }));
    expect(screen.getByText("无分隔符的备注")).toBeInTheDocument();
  });
});

describe("空态与 composer", () => {
  it("无记录时空态文案", () => {
    render(<TicketTimelineColumn logs={[]} />);

    expect(screen.getByText("还没有处理记录。")).toBeInTheDocument();
  });

  it("composer 钉底渲染；不传则不占区", () => {
    const { rerender } = render(
      <TicketTimelineColumn logs={[]} composer={<button type="button">提交跟进</button>} />,
    );
    expect(screen.getByRole("button", { name: "提交跟进" })).toBeInTheDocument();

    rerender(<TicketTimelineColumn logs={[]} />);
    expect(screen.queryByRole("button", { name: "提交跟进" })).not.toBeInTheDocument();
  });
});
