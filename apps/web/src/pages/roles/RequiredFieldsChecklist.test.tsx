import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RequiredFieldsChecklist } from "./RequiredFieldsChecklist";

/**
 * 建单必填字段清单组件测试：字段按表单分组呈现、label 为描述表标准名，勾选状态与 onChange 回调联动。
 */
describe("RequiredFieldsChecklist", () => {
  it("renders all 17 ticket creation fields grouped by form sections", () => {
    render(<RequiredFieldsChecklist value={[]} />);

    expect(screen.getByText("来源与渠道")).toBeInTheDocument();
    expect(screen.getByText("反馈时间")).toBeInTheDocument();
    expect(screen.getByText("反馈渠道")).toBeInTheDocument();

    expect(screen.getByText("业务信息")).toBeInTheDocument();
    expect(screen.getByText("项目（保司）")).toBeInTheDocument();
    expect(screen.getByText("经纪主体")).toBeInTheDocument();
    expect(screen.getByText("支付渠道")).toBeInTheDocument();
    expect(screen.getByText("内部订单号")).toBeInTheDocument();
    expect(screen.getByText("保单号")).toBeInTheDocument();
    expect(screen.getByText("用户投诉渠道")).toBeInTheDocument();

    expect(screen.getByText("客户信息")).toBeInTheDocument();
    expect(screen.getByText("客户姓名")).toBeInTheDocument();
    expect(screen.getByText("客户电话（投保人）")).toBeInTheDocument();
    expect(screen.getByText("联系人电话")).toBeInTheDocument();
    expect(screen.getByText("保司侧是否核身")).toBeInTheDocument();
    expect(screen.getByText("客户诉求")).toBeInTheDocument();
    expect(screen.getByText("客户曾进线")).toBeInTheDocument();
    expect(screen.getByText("进线ID")).toBeInTheDocument();

    expect(screen.getByText("分类与等级")).toBeInTheDocument();
    expect(screen.getByText("客诉类别")).toBeInTheDocument();
    expect(screen.getByText("投诉等级")).toBeInTheDocument();
    expect(screen.getByText("优先级")).toBeInTheDocument();
  });

  it("reflects selected fields as checked", () => {
    render(<RequiredFieldsChecklist value={["customerName", "phone", "channelId"]} />);

    const customerNameCheckbox = screen.getByLabelText("客户姓名");
    const phoneCheckbox = screen.getByLabelText("客户电话（投保人）");
    const channelCheckbox = screen.getByLabelText("反馈渠道");
    const projectCheckbox = screen.getByLabelText("项目（保司）");

    expect(customerNameCheckbox).toBeChecked();
    expect(phoneCheckbox).toBeChecked();
    expect(channelCheckbox).toBeChecked();
    expect(projectCheckbox).not.toBeChecked();
  });

  it("calls onChange with updated selection when toggling checkboxes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<RequiredFieldsChecklist value={["customerName"]} onChange={onChange} />);

    const phoneCheckbox = screen.getByLabelText("客户电话（投保人）");
    await user.click(phoneCheckbox);

    expect(onChange).toHaveBeenCalledWith(expect.arrayContaining(["customerName", "phone"]));
  });

  it("removes field from selection when unchecking", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <RequiredFieldsChecklist
        value={["customerName", "phone", "channelId"]}
        onChange={onChange}
      />,
    );

    const phoneCheckbox = screen.getByLabelText("客户电话（投保人）");
    await user.click(phoneCheckbox);

    expect(onChange).toHaveBeenCalledWith(["customerName", "channelId"]);
  });

  it("renders as disabled when disabled prop is true", () => {
    render(<RequiredFieldsChecklist value={[]} disabled={true} />);

    const checkboxes = screen.getAllByRole("checkbox");
    for (const checkbox of checkboxes) {
      expect(checkbox).toBeDisabled();
    }
  });

  it("does not call onChange when disabled", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<RequiredFieldsChecklist value={[]} onChange={onChange} disabled={true} />);

    const checkbox = screen.getByLabelText("客户姓名");
    await user.click(checkbox);

    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not call onChange when onChange is undefined (read-only mode)", async () => {
    const user = userEvent.setup();

    render(<RequiredFieldsChecklist value={["customerName"]} />);

    const phoneCheckbox = screen.getByLabelText("客户电话（投保人）");
    await user.click(phoneCheckbox);

    // No error thrown, onChange simply not called
  });
});
