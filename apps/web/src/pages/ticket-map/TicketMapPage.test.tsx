import type { Permission, TicketMapLocation } from "@insuredesk/shared";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { calls, callsTo, renderApp } from "@/test/renderApp";
import type { TicketMapChart } from "./TicketMapChart";

const chartProps = vi.hoisted(() => ({
  current: null as ComponentProps<typeof TicketMapChart> | null,
}));

// jsdom 没有 canvas：图表替身只记录入参，交互由测试直接调用回调
vi.mock("./TicketMapChart", () => ({
  TicketMapChart: (props: ComponentProps<typeof TicketMapChart>) => {
    chartProps.current = props;
    return <div data-testid="map-chart">{props.points.length}</div>;
  },
}));

const LOCATIONS: TicketMapLocation[] = [
  {
    code: "440305",
    provinceCode: "440000",
    provinceName: "广东省",
    cityName: "深圳市",
    districtName: "南山区",
    count: 3,
  },
  {
    code: "110105",
    provinceCode: "110000",
    provinceName: "北京市",
    cityName: null,
    districtName: "朝阳区",
    count: 2,
  },
  {
    code: "440399",
    provinceCode: "440000",
    provinceName: "广东省",
    cityName: "深圳市",
    districtName: "已撤销区",
    count: 9,
  },
];

function role(permissions: Permission[]) {
  return { name: "地图测试", permissions };
}

function renderMap(permissions: Permission[]) {
  return renderApp({
    path: "/ticket-map",
    role: role(permissions),
    trpc: {
      "ticketMap.points": LOCATIONS,
      "userFeedbackChannel.filterOptions": [
        { id: "ufc-hotline", name: "内部客服热线", active: true },
      ],
    },
  });
}

beforeEach(() => {
  calls.length = 0;
  chartProps.current = null;
});

describe("工单地图页", () => {
  it("每例一个点；无坐标定位码不画点，也不计入已定位与省份", async () => {
    renderMap(["ticket_map.view", "ticket.view"]);

    expect(await screen.findByTestId("map-chart")).toHaveTextContent("5");
    expect(screen.getByText("已定位 5 例")).toBeInTheDocument();
    expect(chartProps.current?.area.counts.get("440000")).toBe(3);
    expect(chartProps.current?.area.counts.get("110000")).toBe(2);
  });

  it("默认近 90 天实时查询；用户反馈渠道筛选重新查询", async () => {
    renderMap(["ticket_map.view", "ticket.view"]);
    await screen.findByTestId("map-chart");

    const first = callsTo("ticketMap.points")[0]?.input as Record<string, string>;
    const days =
      (new Date(first.createdTo as string).getTime() -
        new Date(first.createdFrom as string).getTime()) /
      86_400_000;
    expect(Math.round(days)).toBe(90);

    fireEvent.click(screen.getByRole("button", { name: "用户反馈渠道" }));
    fireEvent.click(await screen.findByText("内部客服热线"));
    await waitFor(() =>
      expect(callsTo("ticketMap.points").at(-1)?.input).toMatchObject({
        userFeedbackChannelId: ["ufc-hotline"],
      }),
    );
  });

  it("有 ticket.view 时点击红点跳到按地区过滤的工单列表", async () => {
    renderMap(["ticket_map.view", "ticket.view"]);
    await screen.findByTestId("map-chart");

    chartProps.current?.onPointClick?.("440305");
    await waitFor(() =>
      expect(callsTo("ticket.list").at(-1)?.input).toMatchObject({ locationCode: "440305" }),
    );
  });

  it("双击省份只看该省：点与已定位按省过滤，返回全国恢复", async () => {
    renderMap(["ticket_map.view", "ticket.view"]);
    await screen.findByTestId("map-chart");

    act(() => chartProps.current?.onAreaDoubleClick?.("440000"));
    expect(await screen.findByRole("heading", { name: "工单地图 · 广东省" })).toBeInTheDocument();
    await waitFor(() => expect(chartProps.current?.area.areaCode).toBe("440000"));
    expect(chartProps.current?.area.geoJson.features.map((f) => f.properties.name)).toContain(
      "深圳市",
    );
    expect(chartProps.current?.area.counts.get("440300")).toBe(3);
    expect(screen.getByTestId("map-chart")).toHaveTextContent("3");
    expect(screen.getByText("已定位 3 例")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "返回全国" }));
    expect(await screen.findByText("已定位 5 例")).toBeInTheDocument();
    expect(chartProps.current?.area.areaCode).toBeNull();
  });

  it("省内再双击市看区县：点与已定位按市过滤，返回该省恢复；区县视图不再下钻", async () => {
    renderMap(["ticket_map.view", "ticket.view"]);
    await screen.findByTestId("map-chart");

    act(() => chartProps.current?.onAreaDoubleClick?.("440000"));
    await waitFor(() => expect(chartProps.current?.area.areaCode).toBe("440000"));
    await act(async () => chartProps.current?.onAreaDoubleClick?.("440300"));
    expect(
      await screen.findByRole("heading", { name: "工单地图 · 广东省 · 深圳市" }),
    ).toBeInTheDocument();
    await waitFor(() => expect(chartProps.current?.area.areaCode).toBe("440300"));
    expect(chartProps.current?.area.geoJson.features.map((f) => f.properties.name)).toContain(
      "南山区",
    );
    expect(chartProps.current?.area.counts.get("440305")).toBe(3);
    expect(chartProps.current?.onAreaDoubleClick).toBeUndefined();
    expect(screen.getByTestId("map-chart")).toHaveTextContent("3");
    expect(screen.getByRole("button", { name: "显示区名" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "返回广东省" }));
    await waitFor(() => expect(chartProps.current?.area.areaCode).toBe("440000"));
  });

  it("地区检索：省 / 省市 / 省市区三级输入回车即定位，区县高亮；清除回到全国", async () => {
    renderMap(["ticket_map.view", "ticket.view"]);
    await screen.findByTestId("map-chart");
    const input = await screen.findByRole("combobox", { name: "搜索地区" });
    await waitFor(() => expect(input).toBeEnabled());

    fireEvent.change(input, { target: { value: "广东省" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(chartProps.current?.area.areaCode).toBe("440000"));
    expect(input).toHaveValue("广东省");

    fireEvent.change(input, { target: { value: "广东省深圳市" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(chartProps.current?.area.areaCode).toBe("440300"));
    expect(chartProps.current?.highlightCode).toBeNull();

    fireEvent.change(input, { target: { value: "广东省深圳市南山区" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(chartProps.current?.highlightCode).toBe("440305"));
    expect(chartProps.current?.area.areaCode).toBe("440300");
    expect(input).toHaveValue("广东省 深圳市 南山区");

    fireEvent.click(screen.getByRole("button", { name: "清除地区" }));
    await waitFor(() => expect(chartProps.current?.area.areaCode).toBeNull());
    expect(input).toHaveValue("");
  });

  it("地区检索：直辖市的区留在省视图高亮", async () => {
    renderMap(["ticket_map.view", "ticket.view"]);
    const input = await screen.findByRole("combobox", { name: "搜索地区" });
    await waitFor(() => expect(input).toBeEnabled());

    fireEvent.change(input, { target: { value: "北京朝阳" } });
    fireEvent.click(await screen.findByRole("option", { name: /朝阳区/ }));
    await waitFor(() => expect(chartProps.current?.area.areaCode).toBe("110000"));
    expect(chartProps.current?.highlightCode).toBe("110105");
  });

  it("地区下拉逐级浏览：点省定位并展开市，点市进入区县", async () => {
    renderMap(["ticket_map.view", "ticket.view"]);
    await screen.findByTestId("map-chart");
    const toggle = await screen.findByRole("button", { name: "选择地区" });
    await waitFor(() => expect(toggle).toBeEnabled());

    fireEvent.click(toggle);
    fireEvent.click(await screen.findByRole("option", { name: "广东省" }));
    await waitFor(() => expect(chartProps.current?.area.areaCode).toBe("440000"));
    fireEvent.click(await screen.findByRole("option", { name: "深圳市" }));
    await waitFor(() => expect(chartProps.current?.area.areaCode).toBe("440300"));
    expect(await screen.findByRole("option", { name: "南山区" })).toBeInTheDocument();
  });

  it("排名层级：全国可切省/市/区县，直辖市同时计入省与市排名", async () => {
    renderMap(["ticket_map.view", "ticket.view"]);
    const level = (name: string) => screen.findByRole("radio", { name });
    const rows = () =>
      screen
        .getAllByRole("button", { name: /^第 \d+ 名/ })
        .map((row) => row.getAttribute("aria-label"));

    expect(await screen.findByText("省份排名")).toBeInTheDocument();
    await waitFor(() => expect(rows()).toEqual(["第 1 名 广东省 3 例", "第 2 名 北京市 2 例"]));

    fireEvent.click(await level("市"));
    expect(await screen.findByText("城市排名")).toBeInTheDocument();
    expect(rows()).toEqual(["第 1 名 广东省 深圳市 3 例", "第 2 名 北京市 2 例"]);

    fireEvent.click(await level("区县"));
    expect(await screen.findByText("区县排名")).toBeInTheDocument();
    expect(rows()).toEqual(["第 1 名 广东省 深圳市 南山区 3 例", "第 2 名 北京市 朝阳区 2 例"]);
  });

  it("排名层级：进省后省级置灰，默认看市；直辖市省视图只能看区县", async () => {
    renderMap(["ticket_map.view", "ticket.view"]);
    await screen.findByTestId("map-chart");

    act(() => chartProps.current?.onAreaDoubleClick?.("440000"));
    expect(await screen.findByText("城市排名")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "省" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "区县" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "返回全国" }));
    act(() => chartProps.current?.onAreaDoubleClick?.("110000"));
    expect(await screen.findByText("区县排名")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "市" })).toBeDisabled();
  });

  it("点排名行定位地图并高亮；叶子行可跳转工单列表", async () => {
    renderMap(["ticket_map.view", "ticket.view"]);
    fireEvent.click(await screen.findByRole("radio", { name: "区县" }));

    fireEvent.click(
      await screen.findByRole("button", { name: "第 1 名 广东省 深圳市 南山区 3 例" }),
    );
    await waitFor(() => expect(chartProps.current?.area.areaCode).toBe("440300"));
    expect(chartProps.current?.highlightCode).toBe("440305");
    expect(await screen.findByText("区县排名")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "查看南山区工单" }));
    await waitFor(() =>
      expect(callsTo("ticket.list").at(-1)?.input).toMatchObject({ locationCode: "440305" }),
    );
  });

  it("直辖市省视图已是区县，不再下钻", async () => {
    renderMap(["ticket_map.view", "ticket.view"]);
    await screen.findByTestId("map-chart");

    act(() => chartProps.current?.onAreaDoubleClick?.("110000"));
    await waitFor(() => expect(chartProps.current?.area.areaCode).toBe("110000"));
    expect(chartProps.current?.onAreaDoubleClick).toBeUndefined();
  });

  it("地名开关：全国视图切省名，进省后同一开关切市名，直辖市为区名", async () => {
    renderMap(["ticket_map.view", "ticket.view"]);
    await screen.findByTestId("map-chart");
    expect(chartProps.current?.showLabels).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "显示省名" }));
    expect(chartProps.current?.showLabels).toBe(true);
    expect(screen.getByRole("button", { name: "隐藏省名" })).toBeInTheDocument();

    act(() => chartProps.current?.onAreaDoubleClick?.("440000"));
    expect(await screen.findByRole("button", { name: "隐藏市名" })).toBeInTheDocument();
    await waitFor(() => expect(chartProps.current?.area.areaCode).toBe("440000"));
    expect(chartProps.current?.showLabels).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "返回全国" }));
    act(() => chartProps.current?.onAreaDoubleClick?.("110000"));
    expect(await screen.findByRole("button", { name: "隐藏区名" })).toBeInTheDocument();
  });

  it("无 ticket.view 时红点不可点击", async () => {
    renderMap(["ticket_map.view"]);
    await screen.findByTestId("map-chart");
    expect(chartProps.current?.onPointClick).toBeUndefined();
  });

  it("无 ticket_map.view 直接访问进 403", async () => {
    renderMap(["ticket.view"]);
    await waitFor(() => expect(screen.queryByTestId("map-chart")).not.toBeInTheDocument());
    expect(callsTo("ticketMap.points")).toHaveLength(0);
  });
});
