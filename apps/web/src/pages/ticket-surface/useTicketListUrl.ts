import { useCallback, useState } from "react";
import { useSearchParams } from "react-router";

/**
 * URL 驱动的列表查询状态，内外工单列表共用：查询串是唯一事实源，经注入的
 * parse 折成页面自己的 query 形状；写入器统一维护「筛选变更回到第 1 页」。
 * 页面间的差异（query 形状、pageSize、筛选项集合、有无排序）以配置注入。
 */
export function useTicketListUrl<TQuery extends { search?: string }>(
  parse: (params: URLSearchParams) => TQuery,
) {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = parse(searchParams);
  // 未提交的搜索草稿不写在 URL 里；外部导航（后退等）不回灌草稿，与输入框
  // 卸载即丢的口径一致——提交才算数
  const [searchDraft, setSearchDraft] = useState(query.search ?? "");

  /** Set/clear one URL param; filter changes restart from page 1. */
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

  /** 一键清除：草稿与已提交的 q 一起撤。q 本就不在 URL 时不动 URL，免得误回第 1 页。 */
  const clearSearch = useCallback(() => {
    setSearchDraft("");
    if (searchParams.has("q")) {
      setParam("q", null);
    }
  }, [setParam, searchParams]);

  return { query, searchDraft, setSearchDraft, submitSearch, clearSearch, setParam, setParams };
}
