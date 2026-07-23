import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { DateTimePicker } from "./DateTimePicker";

/**
 * The shared 日期时间选择器: a clear affordance appears only when the field
 * holds a value and returns it to the unfilled state ("") — the gap #62
 * closes, since a filled time previously had no way back to 未填写.
 */

function Harness({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <label htmlFor="dt-date">测试日期</label>
      <DateTimePicker
        id="dt"
        value={value}
        onChange={setValue}
        datePickerAriaLabel="打开测试日期选择器"
        timeAriaLabel="测试时间的时分"
      />
      <output data-testid="value">{value}</output>
    </>
  );
}

describe("DateTimePicker 日期 + 分钟输入", () => {
  it("uses compact masked inputs with an explicit 24-hour time format", () => {
    render(<Harness initial="" />);

    const date = screen.getByLabelText("测试日期");
    const time = screen.getByLabelText("测试时间的时分");
    expect(date).toHaveAttribute("placeholder", "YY-MM-DD");
    expect(date).toHaveAttribute("inputmode", "numeric");
    expect(date.closest('[data-slot="input-group"]')).toHaveClass("w-32");
    expect(time).toHaveAttribute("type", "text");
    expect(time).toHaveAttribute("inputmode", "numeric");
    expect(time).toHaveAttribute("placeholder", "HH:mm");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("moves through YY, MM and DD while typing and emits a complete four-digit local date", async () => {
    const user = userEvent.setup();
    const currentYear = new Date().getFullYear();
    const shortYear = String(currentYear).slice(-2);
    render(<Harness initial="" />);

    const date = screen.getByLabelText("测试日期");
    await user.type(date, shortYear);
    expect(date).toHaveValue(`${shortYear}-`);

    await user.type(date, "07");
    expect(date).toHaveValue(`${shortYear}-07-`);

    await user.type(date, "15");

    expect(screen.getByTestId("value")).toHaveTextContent(`${currentYear}-07-15T`);
    expect(date).toHaveValue(`${shortYear}-07-15`);
  });

  it("lets the user enter time before date and preserves the partial value", async () => {
    const user = userEvent.setup();
    render(<Harness initial="" />);

    await user.type(screen.getByLabelText("测试时间的时分"), "0930");

    expect(screen.getByTestId("value")).toHaveTextContent("T09:30");
    expect(screen.getByLabelText("测试时间的时分")).toHaveValue("09:30");
  });

  it("accepts evening times as 00:00–23:59 without an AM/PM control", async () => {
    const user = userEvent.setup();
    render(<Harness initial="" />);

    await user.type(screen.getByLabelText("测试时间的时分"), "2359");

    expect(screen.getByTestId("value")).toHaveTextContent("T23:59");
    expect(screen.getByLabelText("测试时间的时分")).toHaveValue("23:59");
    expect(screen.queryByText(/AM|PM/i)).not.toBeInTheDocument();
  });

  it.each(["2400", "1260"])(
    "does not silently rewrite invalid 24-hour input %s to a different valid time",
    async (input) => {
      const user = userEvent.setup();
      render(<Harness initial="" />);

      await user.type(screen.getByLabelText("测试时间的时分"), input);

      expect(screen.getByTestId("value").textContent).not.toMatch(/^T(?:[01]\d|2[0-3]):[0-5]\d$/);
    },
  );

  it("preserves time when a date is picked and closes the calendar", async () => {
    render(<Harness initial="2026-07-15T09:30" />);

    fireEvent.click(screen.getByRole("button", { name: "打开测试日期选择器" }));
    expect(await screen.findByRole("grid")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /2026年7月16日/ }));

    expect(screen.getByTestId("value")).toHaveTextContent("2026-07-16T09:30");
    expect(screen.getByLabelText("测试日期")).toHaveValue("26-07-16");
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  });

  it("hides the clear button when unset", () => {
    render(<Harness initial="" />);
    expect(screen.queryByRole("button", { name: "清空时间" })).not.toBeInTheDocument();
  });

  it("clears system-prefilled date and time even when the user has not touched either input", () => {
    render(<Harness initial="2026-07-15T09:30" />);

    const clear = screen.getByRole("button", { name: "清空时间" });
    expect(clear).toBeInTheDocument();

    fireEvent.click(clear);

    expect(screen.getByTestId("value")).toHaveTextContent("");
    expect(screen.getByLabelText("测试日期")).toHaveValue("");
    expect(screen.getByLabelText("测试时间的时分")).toHaveValue("");
    expect(screen.queryByRole("button", { name: "清空时间" })).not.toBeInTheDocument();
  });
});
