import { useCallback, useState } from "react";
import { useSearchParams } from "react-router";

export function useTicketListUrl<TQuery extends { search?: string }>(
  parse: (params: URLSearchParams) => TQuery,
) {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = parse(searchParams);
  // 未提交的搜索草稿不写在 URL 里；外部导航（后退等）不回灌草稿，与输入框
  // 卸载即丢的口径一致——提交才算数
  const [searchDraft, setSearchDraft] = useState(query.search ?? "");

  const setParam = useCallback(
    (key: string, value: string | null, { resetPage = true } = {}) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (value === null) {
          next.delete(key);
        } else {
          next.set(key, value);
        }
        if (resetPage) {
          next.delete("page");
        }
        return next;
      });
    },
    [setSearchParams],
  );

  /** 成对/成组参数同进同出（如创建时间区间起止），避免半生效的中间态。 */
  const setParams = useCallback(
    (updates: Readonly<Record<string, string | null>>) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(updates)) {
          if (value === null) {
            next.delete(key);
          } else {
            next.set(key, value);
          }
        }
        next.delete("page");
        return next;
      });
    },
    [setSearchParams],
  );

  const submitSearch = useCallback(() => {
    setParam("q", searchDraft.trim() || null);
  }, [setParam, searchDraft]);

  /** q 本就不在 URL 时不动 URL——setParam 会顺带回第 1 页。 */
  const clearSearch = useCallback(() => {
    setSearchDraft("");
    if (searchParams.has("q")) {
      setParam("q", null);
    }
  }, [setParam, searchParams]);

  return { query, searchDraft, setSearchDraft, submitSearch, clearSearch, setParam, setParams };
}
