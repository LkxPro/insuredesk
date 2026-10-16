import {
  DEFAULT_TICKET_SOURCE_FILTER,
  type TicketMapLocation,
  type TicketMapPointsInput,
  ticketAddressLocationCode,
} from "@insuredesk/shared";
import type { AuthenticatedUser } from "./auth.service.ts";
import { buildTicketListWhere, type TicketServiceDeps } from "./ticket.service.ts";

/**
 * 统计口径复用工单列表 WHERE（含数据范围、软删除排除、source 默认排除归档单），
 * 地图下钻到列表时同条件条数必然一致。
 */
export async function getTicketMapLocations(
  { prisma, clock }: TicketServiceDeps,
  viewer: AuthenticatedUser,
  input: TicketMapPointsInput,
): Promise<TicketMapLocation[]> {
  const listWhere = await buildTicketListWhere(
    prisma,
    viewer,
    {
      createdFrom: input.createdFrom,
      createdTo: input.createdTo,
      userFeedbackChannelId: input.userFeedbackChannelId,
      source: [...DEFAULT_TICKET_SOURCE_FILTER],
    },
    clock.now(),
  );
  const groups = await prisma.ticket.groupBy({
    by: ["provinceCode", "cityCode", "districtCode", "provinceName", "cityName", "districtName"],
    where: { ...listWhere, provinceCode: { not: null } },
    _count: { _all: true },
  });

  // 名称是写入时快照，同码可能因区划更名出现多组名称：按码合并，取首组名称
  const byCode = new Map<string, TicketMapLocation>();
  for (const group of groups) {
    const code = ticketAddressLocationCode(group);
    if (code === null || group.provinceCode === null || group.provinceName === null) {
      continue;
    }
    const existing = byCode.get(code);
    byCode.set(code, {
      code,
      provinceCode: group.provinceCode,
      provinceName: existing?.provinceName ?? group.provinceName,
      cityName: existing ? existing.cityName : group.cityName,
      districtName: existing ? existing.districtName : group.districtName,
      count: (existing?.count ?? 0) + group._count._all,
    });
  }
  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
}
