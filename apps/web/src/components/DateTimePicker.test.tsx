import { fireEvent, render, screen } from "@testing-library/react";
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
      <DateTimePicker id="dt" value={value} onChange={setValue} />
      <output data-testid="value">{value}</output>
    </>
  );
}

describe("DateTimePicker 清空能力", () => {
  it("hides the clear button when unset", () => {
    render(<Harness initial="" />);
    expect(screen.queryByRole("button", { name: "清空时间" })).not.toBeInTheDocument();
  });

  it("shows the clear button when a value is present, and clearing returns to unfilled", () => {
    render(<Harness initial="2026-07-15T09:30" />);

    const clear = screen.getByRole("button", { name: "清空时间" });
    expect(clear).toBeInTheDocument();

    fireEvent.click(clear);

    expect(screen.getByTestId("value")).toHaveTextContent("");
    expect(screen.queryByRole("button", { name: "清空时间" })).not.toBeInTheDocument();
  });
});
