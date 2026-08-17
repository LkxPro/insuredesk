import { TICKET_CREATE_FIELD_KEYS, TICKET_FIELDS } from "@insuredesk/shared";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RequiredFieldsChecklist } from "./RequiredFieldsChecklist";

/**
 * 建单必填字段清单组件测试：字段按表单分组呈现、label 为描述表标准名，勾选状态与 onChange 回调联动。
 */
describe("RequiredFieldsChecklist", () => {
  it("renders every ticket creation field with its 标准名, grouped by form sections", () => {
    render(<RequiredFieldsChecklist value={[]} />);

    for (const section of ["来源与渠道", "业务信息", "客户信息", "分类与等级"]) {
      expect(screen.getByText(section)).toBeInTheDocument();
    }
    // 描述表加字段但漏排进分组时，这里按清单逐个点名报警
    for (const key of TICKET_CREATE_FIELD_KEYS) {
      expect(screen.getByLabelText(TICKET_FIELDS[key].label)).toBeInTheDocument();
    }
    expect(screen.getAllByRole("checkbox")).toHaveLength(TICKET_CREATE_FIELD_KEYS.length);
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
