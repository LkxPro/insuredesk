import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { CatalogCombobox } from "./CatalogCombobox";

// Base UI 的列表导航/定位用到 jsdom 没有的滚动与指针捕获 API
beforeAll(() => {
  Object.assign(window.HTMLElement.prototype, {
    scrollIntoView: vi.fn(),
    hasPointerCapture: vi.fn(() => false),
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
  });
});

const OPTIONS = [
  { id: "hm", name: "黑猫投诉" },
  { id: "rd", name: "12378热线" },
  { id: "jg", name: "监管转办" },
  { id: "ts", name: "聚投诉平台" },
];

function Harness({ initialValue = "" }: { initialValue?: string }) {
  const [value, setValue] = useState(initialValue);
  return (
    <div data-testid="root">
      <CatalogCombobox id="channel" options={OPTIONS} value={value} onChange={setValue} />
      <output data-testid="value">{value}</output>
    </div>
  );
}

function openAndType(text: string) {
  const input = screen.getByRole("combobox");
  fireEvent.mouseDown(input);
  fireEvent.change(input, { target: { value: text } });
  return input;
}

describe("CatalogCombobox", () => {
  it("中文子串过滤并高亮命中片段", () => {
    render(<Harness />);
    openAndType("投诉");
    const items = screen.getAllByRole("option");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("黑猫投诉");
    expect(items[1]).toHaveTextContent("聚投诉平台");
    expect(items[0]?.querySelector("mark")).toHaveTextContent("投诉");
  });

  it("全拼连打过滤", () => {
    render(<Harness />);
    openAndType("heimao");
    const items = screen.getAllByRole("option");
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent("黑猫投诉");
  });

  it("首字母连打过滤", () => {
    render(<Harness />);
    openAndType("jgzb");
    const items = screen.getAllByRole("option");
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent("监管转办");
  });

  it("点击选项后回填并提交 id", () => {
    render(<Harness />);
    openAndType("黑猫");
    fireEvent.click(screen.getByRole("option", { name: /黑猫投诉/ }));
    expect(screen.getByTestId("value")).toHaveTextContent("hm");
    expect(screen.getByRole("combobox")).toHaveValue("黑猫投诉");
  });

  it("键盘 ↓ + 回车选中首个匹配", () => {
    render(<Harness />);
    const input = openAndType("投诉");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByTestId("value")).toHaveTextContent("hm");
  });

  it("清除钮把值清空", () => {
    render(<Harness initialValue="hm" />);
    fireEvent.click(screen.getByRole("button", { name: "清除选择" }));
    expect(screen.getByTestId("value")).toHaveTextContent("");
  });

  it("无匹配时显示空态", () => {
    render(<Harness />);
    openAndType("xyz");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText("无匹配项")).toBeInTheDocument();
  });

  it("已有选中值时重新打开仍是全量列表", () => {
    render(<Harness initialValue="hm" />);
    const input = screen.getByRole("combobox");
    fireEvent.mouseDown(input);
    expect(screen.getAllByRole("option")).toHaveLength(OPTIONS.length);
  });

  it("弹层渲染在组件容器内（modal Dialog 里才可点可滚）", () => {
    render(<Harness />);
    const root = screen.getByTestId("root");
    fireEvent.mouseDown(screen.getByRole("combobox"));
    const listbox = screen.getByRole("listbox");
    expect(root.contains(listbox)).toBe(true);
  });
});
