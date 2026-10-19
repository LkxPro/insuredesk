import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { RegionCascader } from "./RegionCascader";
import type { AddressFormValue } from "./TicketFormFields";

beforeAll(() => {
  Object.assign(window.HTMLElement.prototype, {
    scrollIntoView: vi.fn(),
    hasPointerCapture: vi.fn(() => false),
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
  });
});

function Harness({
  initial = null,
  storedLabel,
}: {
  initial?: AddressFormValue | null;
  storedLabel?: string;
}) {
  const [value, setValue] = useState<AddressFormValue | null>(initial);
  return (
    <>
      <RegionCascader id="address" value={value} onChange={setValue} storedLabel={storedLabel} />
      <output data-testid="value">{JSON.stringify(value)}</output>
    </>
  );
}

const value = () => JSON.parse(screen.getByTestId("value").textContent ?? "null");

async function pick(index: number, text: string, option: RegExp) {
  await waitFor(() => expect(screen.getAllByRole("combobox")[index]).toBeEnabled());
  const input = screen.getAllByRole("combobox")[index] as HTMLElement;
  fireEvent.mouseDown(input);
  fireEvent.change(input, { target: { value: text } });
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

describe("RegionCascader", () => {
  it("省→市→区县逐级选到叶子才 complete，换选上级清空下级", async () => {
    render(<Harness />);
    await pick(0, "广东", /广东省/);
    expect(value()).toEqual({
      provinceCode: "440000",
      cityCode: null,
      districtCode: null,
      complete: false,
    });
    await pick(1, "深圳", /深圳市/);
    expect(value()).toMatchObject({ cityCode: "440300", complete: false });
    await pick(2, "南山", /南山区/);
    expect(value()).toEqual({
      provinceCode: "440000",
      cityCode: "440300",
      districtCode: "440305",
      complete: true,
    });

    await pick(1, "东莞", /东莞市/);
    expect(value()).toEqual({
      provinceCode: "440000",
      cityCode: "441900",
      districtCode: null,
      complete: true,
    });
    expect(screen.getAllByRole("combobox")).toHaveLength(2);
  });

  it("直辖市省下直接是区县", async () => {
    render(<Harness />);
    await pick(0, "北京", /北京市/);
    expect(screen.getAllByRole("combobox")[1]).toHaveAttribute("placeholder", "区县");
    await pick(1, "朝阳", /朝阳区/);
    expect(value()).toEqual({
      provinceCode: "110000",
      cityCode: null,
      districtCode: "110105",
      complete: true,
    });
  });

  it("清空省 = 无地址", async () => {
    render(
      <Harness
        initial={{ provinceCode: "710000", cityCode: null, districtCode: null, complete: true }}
      />,
    );
    await waitFor(() => expect(screen.getAllByRole("combobox")[0]).toHaveValue("台湾省"));
    fireEvent.click(screen.getByRole("button", { name: "清除选择" }));
    expect(value()).toBeNull();
  });

  it("已存码不在区划数据中：提示已存名称，值不变", async () => {
    const stale = {
      provinceCode: "440000",
      cityCode: "440300",
      districtCode: "440399",
      complete: true,
    };
    render(<Harness initial={stale} storedLabel="广东省 深圳市 已撤销区" />);
    expect(await screen.findByText(/已存地址「广东省 深圳市 已撤销区」/)).toBeInTheDocument();
    expect(value()).toEqual(stale);
  });
});
