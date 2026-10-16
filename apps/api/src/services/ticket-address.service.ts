import {
  formatTicketAddress,
  TICKET_ADDRESS_INVALID_MESSAGE,
  TICKET_ADDRESS_LABEL,
  type TicketAddressCodes,
} from "@insuredesk/shared";
import { resolveRegionAddress } from "@insuredesk/shared/region";

export class TicketAddressInvalidError extends Error {
  constructor() {
    super(TICKET_ADDRESS_INVALID_MESSAGE);
    this.name = "TicketAddressInvalidError";
  }
}

export interface TicketAddressColumns {
  provinceCode: string | null;
  provinceName: string | null;
  cityCode: string | null;
  cityName: string | null;
  districtCode: string | null;
  districtName: string | null;
}

export const EMPTY_TICKET_ADDRESS: TicketAddressColumns = {
  provinceCode: null,
  provinceName: null,
  cityCode: null,
  cityName: null,
  districtCode: null,
  districtName: null,
};

/** 名称一律按码从区划树回填，不信任客户端。 */
export function toTicketAddressColumns(codes: TicketAddressCodes | null): TicketAddressColumns {
  if (codes === null) {
    return EMPTY_TICKET_ADDRESS;
  }
  const resolved = resolveRegionAddress(codes);
  if (!resolved) {
    throw new TicketAddressInvalidError();
  }
  return resolved;
}

export function sameTicketAddress(a: TicketAddressColumns, b: TicketAddressColumns): boolean {
  return (
    a.provinceCode === b.provinceCode &&
    a.cityCode === b.cityCode &&
    a.districtCode === b.districtCode
  );
}

export function ticketAddressRemarkLine(
  before: TicketAddressColumns,
  after: TicketAddressColumns,
): string {
  const side = (address: TicketAddressColumns) => formatTicketAddress(address) || "（空）";
  return `${TICKET_ADDRESS_LABEL}: ${side(before)}→${side(after)}`;
}
