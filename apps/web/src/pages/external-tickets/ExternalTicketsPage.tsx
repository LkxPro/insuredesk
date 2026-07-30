import { useSearchParams } from "react-router";
import { ExternalTabBar, externalTabFromParams } from "./ExternalTabBar";
import { ExternalTicketListPane } from "./ExternalTicketListPane";
import { ExternalTicketSubmitPane } from "./ExternalTicketSubmitPane";

/**
 * 外部端主页：提交即首屏。提交与 我的工单 是同页两个 tab（编码见
 * ExternalTabBar），深链可直接落到带筛选的列表；详情是独立路由，
 * 与这里共用同一 tab 顶栏。
 */
export function ExternalTicketsPage() {
  const [searchParams] = useSearchParams();
  const tab = externalTabFromParams(searchParams);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <ExternalTabBar active={tab} />
      {tab === "submit" ? <ExternalTicketSubmitPane /> : <ExternalTicketListPane />}
    </div>
  );
}
