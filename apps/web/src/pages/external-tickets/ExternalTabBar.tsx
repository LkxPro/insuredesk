import { Link, useSearchParams } from "react-router";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * 外部端共用的 tab 顶栏：提交 / 我的工单。tab 状态住在 ?tab 里（缺省 =
 * 提交——外部端首页即提交），编码只认这一处；tab 本身就是导航（链接触发
 * 路由切换），主页按 ?tab 渲染对应内容，详情页借它回列表或转去提交——
 * 所以当前 tab 也是可点的链接（详情页上点 我的工单 即返回列表）。
 * 列表筛选参数随链接保留，切 tab 再切回筛选不丢。
 */

export type ExternalTab = "submit" | "list";

export function externalTabFromParams(params: URLSearchParams): ExternalTab {
  return params.get("tab") === "list" ? "list" : "submit";
}

export function ExternalTabBar({ active }: { active: ExternalTab }) {
  const [searchParams] = useSearchParams();

  function href(tab: ExternalTab) {
    const params = new URLSearchParams(searchParams);
    if (tab === "submit") {
      params.delete("tab");
    } else {
      params.set("tab", tab);
    }
    const query = params.toString();
    return `/external-tickets${query ? `?${query}` : ""}`;
  }

  return (
    // manual：方向键只移焦点，激活交给锚点自身的 Enter——automatic 模式下
    // radix 试图改受控 value，键盘导航会空转
    <Tabs value={active} activationMode="manual">
      <TabsList>
        <TabsTrigger value="submit" asChild>
          <Link to={href("submit")}>提交工单</Link>
        </TabsTrigger>
        <TabsTrigger value="list" asChild>
          <Link to={href("list")}>我的工单</Link>
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
