import type { CreatedRangeQuery } from "@insuredesk/shared";
import { useSearchParams } from "react-router";

export function useCreatedRangeQueryParams(): [
  CreatedRangeQuery,
  (range: CreatedRangeQuery) => void,
] {
  const [params, setParams] = useSearchParams();

  const createdFrom = parseISOParam(params.get("createdFrom"));
  const createdTo = parseISOParam(params.get("createdTo"));
  const range: CreatedRangeQuery = {
    ...(createdFrom && { createdFrom }),
    ...(createdTo && { createdTo }),
  };

  function setRange(next: CreatedRangeQuery) {
    setParams((prev: URLSearchParams) => {
      const updated = new URLSearchParams(prev);
      if (next.createdFrom) {
        updated.set("createdFrom", next.createdFrom);
      } else {
        updated.delete("createdFrom");
      }
      if (next.createdTo) {
        updated.set("createdTo", next.createdTo);
      } else {
        updated.delete("createdTo");
      }
      return updated;
    });
  }

  return [range, setRange];
}

function parseISOParam(value: string | null): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : value;
  } catch {
    return undefined;
  }
}
