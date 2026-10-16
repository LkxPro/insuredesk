import { z } from "zod";

const regionCodeSchema = z.string().regex(/^\d{6}$/, "区划码格式不正确");

/**
 * 地址入参只收码；名称由服务端按区划树回填。完整路径校验需要区划树，
 * 不在此 schema 里做——主入口不得静态引用区划树（见 ./region）。
 * 编辑语义：字段缺省 = 保留原值，null = 清空，对象 = 整体替换。
 */
export const ticketAddressInputSchema = z.object({
  provinceCode: regionCodeSchema,
  cityCode: regionCodeSchema.nullable(),
  districtCode: regionCodeSchema.nullable(),
});

export type TicketAddressCodes = z.infer<typeof ticketAddressInputSchema>;

export interface TicketAddress extends TicketAddressCodes {
  readonly provinceName: string;
  readonly cityName: string | null;
  readonly districtName: string | null;
}

export const TICKET_ADDRESS_LABEL = "地址";

export const TICKET_ADDRESS_EXPORT_HEADERS = {
  province: "省",
  city: "市",
  district: "区县",
} as const;

export const TICKET_ADDRESS_INVALID_MESSAGE = "地址须从省选到最后一级区划";

/** 定位码：地址叶子节点的区划码，地图点位与列表地区过滤共用。 */
export function ticketAddressLocationCode(address: {
  provinceCode: string | null;
  cityCode: string | null;
  districtCode: string | null;
}): string | null {
  return address.districtCode ?? address.cityCode ?? address.provinceCode;
}

export function formatTicketAddress(address: {
  provinceName: string | null;
  cityName: string | null;
  districtName: string | null;
}): string {
  return [address.provinceName, address.cityName, address.districtName]
    .filter((part): part is string => Boolean(part))
    .join(" ");
}
