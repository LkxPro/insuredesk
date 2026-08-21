import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { presetToCreatedRange } from "@/lib/created-range";
import { auth, callsTo, renderApp, userWith } from "@/test/renderApp";
import { TEST_ROLES } from "@/test/roles";

/**
 * 时钟固定在 2026-07-15（周三），预设边界才有唯一期望值。
 */

const NOW = new Date(2026, 6, 15, 10, 30, 0, 0);

function renderAt(path: string) {
  return renderApp({ path, trpc: {} });
}

function listInputs(): Array<Record<string, unknown>> {
  return callsTo("ticket.list").map((call) => call.input as Record<string, unknown>);
}

/** 创建时间筛选触发器（排序表头同名，按可及名字前缀区分）。 */
function trigger() {
  return screen.getByRole("button", { name: /^创建时间筛选：/ });
}

async function pickOption(name: string) {
  fireEvent.click(trigger());
  fireEvent.click(await screen.findByRole("button", { name }));
}

/**
 * 弹层内容每次 re-render 都换新节点，句柄必须即时取——上一次 findBy 拿到的
 * 按钮此刻已脱离文档，点它不会触发 onSelect。
 */
async function clickDay(name: RegExp) {
  await screen.findByRole("button", { name });
  fireEvent.click(screen.getByRole("button", { name }));
}

beforeEach(() => {
  auth.user = userWith(TEST_ROLES.CS_MANAGER);
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("默认「全部」", () => {
  it("不写入时间参数，入参无创建时间区间", async () => {
    renderAt("/tickets");

    await waitFor(() => expect(listInputs().length).toBeGreaterThan(0));
    expect(listInputs()[0]?.createdFrom).toBeUndefined();
    expect(listInputs()[0]?.createdTo).toBeUndefined();
    expect(trigger()).not.toHaveTextContent(/本|自定义/);
  });
});

describe("预设 → 绝对时刻进入查询", () => {
  it.each([
    ["本日", "today"],
    ["本周", "thisWeek"],
    ["本月", "thisMonth"],
    ["近 7 天", "last7Days"],
    ["近 30 天", "last30Days"],
  ] as const)("选「%s」下传该预设的边界", async (label, preset) => {
    renderAt("/tickets");
    await waitFor(() => expect(listInputs().length).toBeGreaterThan(0));

    await pickOption(label);

    const expected = presetToCreatedRange(preset, NOW);
    await waitFor(() => expect(listInputs().at(-1)?.createdFrom).toBe(expected.createdFrom));
    expect(listInputs().at(-1)?.createdTo).toBe(expected.createdTo);
  });

  it("选预设后重置页码，其余筛选保持", async () => {
    renderAt("/tickets?status=overdue&page=3");
    await waitFor(() => expect(listInputs().length).toBeGreaterThan(0));

    await pickOption("本月");

    await waitFor(() => expect(listInputs().at(-1)?.createdFrom).toBeTruthy());
    expect(listInputs().at(-1)).toMatchObject({ status: ["overdue"], page: 1 });
  });

  it("选回「全部」清掉区间", async () => {
    const thisMonth = presetToCreatedRange("thisMonth", NOW);
    renderAt(
      `/tickets?createdFrom=${encodeURIComponent(thisMonth.createdFrom)}&createdTo=${encodeURIComponent(thisMonth.createdTo)}`,
    );
    await waitFor(() => expect(listInputs()[0]?.createdFrom).toBe(thisMonth.createdFrom));

    await pickOption("全部");

    await waitFor(() => expect(listInputs().at(-1)?.createdFrom).toBeUndefined());
    expect(listInputs().at(-1)?.createdTo).toBeUndefined();
  });
});

describe("深链回显（反查）", () => {
  it("等于预设边界的深链高亮该预设并回显预设名", async () => {
    const week = presetToCreatedRange("thisWeek", NOW);
    renderAt(
      `/tickets?createdFrom=${encodeURIComponent(week.createdFrom)}&createdTo=${encodeURIComponent(week.createdTo)}`,
    );
    await waitFor(() => expect(listInputs().length).toBeGreaterThan(0));

    expect(trigger()).toHaveTextContent("本周");
    fireEvent.click(trigger());
    expect(await screen.findByRole("button", { name: "本周" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("非预设边界的深链回显自定义区间", async () => {
    const from = new Date(2026, 6, 6, 0, 0, 0, 0).toISOString();
    const to = new Date(2026, 6, 12, 23, 59, 59, 999).toISOString();
    renderAt(
      `/tickets?createdFrom=${encodeURIComponent(from)}&createdTo=${encodeURIComponent(to)}`,
    );
    await waitFor(() => expect(listInputs().length).toBeGreaterThan(0));

    expect(trigger()).toHaveTextContent("自定义 07-06 ~ 07-12");
  });
});

describe("自定义起止日期", () => {
  it("在日历上点起止两天 → 撑满两端日界的绝对区间", async () => {
    renderAt("/tickets");
    await waitFor(() => expect(listInputs().length).toBeGreaterThan(0));

    await pickOption("自定义");
    await clickDay(/2026年7月6日/);
    await clickDay(/2026年7月12日/);

    await waitFor(() =>
      expect(listInputs().at(-1)?.createdFrom).toBe(new Date(2026, 6, 6, 0, 0, 0, 0).toISOString()),
    );
    expect(listInputs().at(-1)?.createdTo).toBe(
      new Date(2026, 6, 12, 23, 59, 59, 999).toISOString(),
    );
    expect(trigger()).toHaveTextContent("自定义 07-06 ~ 07-12");
  });

  it("只点了起始日时不发查询——半开区间不是用户的意图", async () => {
    renderAt("/tickets");
    await waitFor(() => expect(listInputs().length).toBeGreaterThan(0));
    const before = listInputs().length;

    await pickOption("自定义");
    await clickDay(/2026年7月6日/);

    expect(listInputs().length).toBe(before);
  });
});

describe("脏参数降级", () => {
  it("非法起始时刻降级到不筛时间，其余筛选不受影响", async () => {
    renderAt("/tickets?createdFrom=昨天&status=overdue");

    await waitFor(() => expect(listInputs().length).toBeGreaterThan(0));
    expect(listInputs()[0]?.createdFrom).toBeUndefined();
    expect(listInputs()[0]).toMatchObject({ status: ["overdue"] });
  });

  it("只有一端非法时保留另一端", async () => {
    const to = new Date(2026, 6, 12, 23, 59, 59, 999).toISOString();
    renderAt(`/tickets?createdFrom=x&createdTo=${encodeURIComponent(to)}`);

    await waitFor(() => expect(listInputs().length).toBeGreaterThan(0));
    expect(listInputs()[0]?.createdFrom).toBeUndefined();
    expect(listInputs()[0]?.createdTo).toBe(to);
  });
});
