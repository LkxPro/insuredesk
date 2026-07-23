import type { Permission } from "@insuredesk/shared";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { auth, callsTo, renderApp, restFetch, toastSpies, userWith } from "@/test/renderApp";
import { TEST_ROLES } from "@/test/roles";

/**
 * 批量导入 entry point: the 导入 button is gated on ticket.import (无权限 UI
 * 无入口 — even the exporting 客服主管 lacks it until 勾选), the dialog's
 * 下载模板 fetches GET /api/tickets/import-template over the global fetch
 * (restFetch), the upload posts multipart to the same transport, and a server
 * rejection surfaces as a toast.
 */

/** 客服主管 plus the manually 勾选-ed ticket.import. */
const IMPORTER = {
  name: "客服主管",
  permissions: [...TEST_ROLES.CS_MANAGER.permissions, "ticket.import"] as Permission[],
};

/** IMPORTER plus ticket.delete — the 撤销 button's permission gate. */
const REVOKER = {
  name: "客服主管",
  permissions: [...IMPORTER.permissions, "ticket.delete"] as Permission[],
};

type BatchItem = {
  id: string;
  importedAt: string;
  importerName: string;
  rowCount: number;
  filename: string;
  status: "revocable" | "locked" | "revoked";
  revokedAt: string | null;
  revokedByName: string | null;
};

/** Mutable per-test fixture behind ticket.importBatches. */
const importBatches: { items: BatchItem[] } = { items: [] };

/** Calls to ticket.revokeImportBatch, in order. */
function revokeCalls() {
  return callsTo("ticket.revokeImportBatch");
}

function renderTickets() {
  return renderApp({
    path: "/tickets",
    trpc: {
      "ticket.importBatches": () => ({
        items: importBatches.items,
        total: importBatches.items.length,
        page: 1,
        pageSize: 50,
      }),
      "ticket.revokeImportBatch": () => ({ revoked: importBatches.items[0]?.rowCount ?? 0 }),
    },
  });
}

beforeEach(() => {
  auth.user = userWith(IMPORTER);
  importBatches.items = [];
});

async function openImportDialog() {
  fireEvent.click(await screen.findByRole("button", { name: /导入/ }));
  return screen.findByRole("dialog", { name: "导入工单" });
}

describe("permission gating (无权限 UI 无入口)", () => {
  it("hides the 导入 button without ticket.import — export alone is not enough", async () => {
    auth.user = userWith(TEST_ROLES.CS_MANAGER); // ticket.export but no import
    renderTickets();

    expect(await screen.findByRole("button", { name: /导出/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /导入/ })).not.toBeInTheDocument();
  });

  it("shows the 导入 button for holders of ticket.import", async () => {
    renderTickets();
    expect(await screen.findByRole("button", { name: /导入/ })).toBeInTheDocument();
  });
});

describe("导入弹窗", () => {
  it("opens with 下载模板 and the file picker", async () => {
    renderTickets();
    const dialog = await openImportDialog();

    expect(dialog).toHaveTextContent("下载模板");
    expect(dialog).toHaveTextContent("点击选择填写好的模板文件");
    expect(screen.getByRole("button", { name: "上传并导入" })).toBeDisabled();
  });

  it("下载模板 fetches the dynamic template endpoint", async () => {
    restFetch.mockResolvedValue(
      new Response("xlsx", {
        status: 200,
        headers: {
          "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
      }),
    );
    renderTickets();
    await openImportDialog();

    fireEvent.click(screen.getByRole("button", { name: /下载模板/ }));

    await waitFor(() => expect(restFetch).toHaveBeenCalledTimes(1));
    const url = new URL(String(restFetch.mock.calls[0]?.[0]), "http://localhost");
    expect(url.pathname).toBe("/api/tickets/import-template");
    expect(toastSpies.error).not.toHaveBeenCalled();
  });

  it("surfaces a server rejection as a toast", async () => {
    restFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: "Missing required permission: ticket.import" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    );
    renderTickets();
    await openImportDialog();

    fireEvent.click(screen.getByRole("button", { name: /下载模板/ }));

    await waitFor(() =>
      expect(toastSpies.error).toHaveBeenCalledWith("Missing required permission: ticket.import"),
    );
  });
});

describe("上传导入", () => {
  function selectFile(name = "填好的模板.xlsx") {
    const file = new File(["xlsx-bytes"], name, {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    fireEvent.change(screen.getByLabelText("选择导入文件"), { target: { files: [file] } });
    return file;
  }

  it("posts the file and zone as multipart and reports 成功导入 N 条", async () => {
    restFetch.mockResolvedValue(
      new Response(JSON.stringify({ imported: 42 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    renderTickets();
    const dialog = await openImportDialog();
    selectFile();

    fireEvent.click(screen.getByRole("button", { name: "上传并导入" }));

    await waitFor(() => expect(dialog).toHaveTextContent("成功导入 42 条"));
    const [url, init] = restFetch.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe("/api/tickets/import");
    expect(init.method).toBe("POST");
    const formData = init.body as FormData;
    expect(formData.get("timeZone")).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect((formData.get("file") as File).name).toBe("填好的模板.xlsx");
  });

  it("renders the 行号/列名/原因 list on an all-or-nothing rejection", async () => {
    restFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "导入校验未通过，共 4 个错误",
          rowErrors: [
            { row: 3, column: "反馈渠道", message: "「不存在的渠道」不存在" },
            { row: 5, column: null, message: "与第 4 行完全重复（20 个字段全部相同）" },
            { row: 6, column: "完结状态", message: "「旧口径」已停用" },
            {
              row: 7,
              column: null,
              message: "「完结状态」与「完结备注」须同时填写或同时留空（该行只填写了其中一列）",
            },
          ],
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
    );
    renderTickets();
    const dialog = await openImportDialog();
    selectFile();

    fireEvent.click(screen.getByRole("button", { name: "上传并导入" }));

    await waitFor(() => expect(dialog).toHaveTextContent("导入校验未通过，共 4 个错误"));
    expect(dialog).toHaveTextContent("第 3 行");
    expect(dialog).toHaveTextContent("反馈渠道");
    expect(dialog).toHaveTextContent("「不存在的渠道」不存在");
    expect(dialog).toHaveTextContent("第 5 行");
    expect(dialog).toHaveTextContent("完全重复");
    // 完结迁移两列的错误走同一逐行清单
    expect(dialog).toHaveTextContent("第 6 行");
    expect(dialog).toHaveTextContent("完结状态");
    expect(dialog).toHaveTextContent("「旧口径」已停用");
    expect(dialog).toHaveTextContent("第 7 行");
    expect(dialog).toHaveTextContent("同时填写或同时留空");
  });

  it("rejects an oversized file locally without a request", async () => {
    renderTickets();
    const dialog = await openImportDialog();
    const oversized = new File([new Uint8Array(1024)], "big.xlsx");
    Object.defineProperty(oversized, "size", { value: 2 * 1024 * 1024 + 1 });
    fireEvent.change(screen.getByLabelText("选择导入文件"), { target: { files: [oversized] } });

    fireEvent.click(screen.getByRole("button", { name: "上传并导入" }));

    await waitFor(() => expect(dialog).toHaveTextContent("文件大小超过 2MB 上限"));
    expect(restFetch).not.toHaveBeenCalled();
  });
});

describe("导入历史", () => {
  function batchItem(overrides: Partial<BatchItem> = {}): BatchItem {
    return {
      id: "batch-1",
      importedAt: "2026-07-17T02:00:00.000Z",
      importerName: "导入员一号",
      rowCount: 42,
      filename: "七月批次.xlsx",
      status: "revocable",
      revokedAt: null,
      revokedByName: null,
      ...overrides,
    };
  }

  it("lists batches with time, importer, count, filename and status", async () => {
    importBatches.items = [
      batchItem(),
      batchItem({ id: "batch-2", filename: "锁定批次.xlsx", status: "locked" }),
      batchItem({
        id: "batch-3",
        filename: "已撤批次.xlsx",
        status: "revoked",
        revokedAt: "2026-07-17T03:00:00.000Z",
        revokedByName: "管理员",
      }),
    ];
    renderTickets();
    await openImportDialog();

    const history = await screen.findByRole("list", { name: "导入历史" });
    expect(history).toHaveTextContent("导入员一号");
    expect(history).toHaveTextContent("42 条");
    expect(history).toHaveTextContent("七月批次.xlsx");
    expect(history).toHaveTextContent("可撤销");
    expect(history).toHaveTextContent("已锁定");
    expect(history).toHaveTextContent("已撤销");
    // 已撤销批次显示撤销人与撤销时刻
    expect(history).toHaveTextContent(/由 管理员 于 .+ 撤销/);
  });

  it("hides 撤销 without ticket.delete — even on revocable batches", async () => {
    importBatches.items = [batchItem()];
    renderTickets();
    await openImportDialog();

    await screen.findByRole("list", { name: "导入历史" });
    expect(screen.queryByRole("button", { name: "撤销" })).not.toBeInTheDocument();
  });

  it("shows 撤销 only on revocable batches for ticket.delete holders", async () => {
    auth.user = userWith(REVOKER);
    importBatches.items = [
      batchItem(),
      batchItem({ id: "batch-2", status: "locked" }),
      batchItem({ id: "batch-3", status: "revoked" }),
    ];
    renderTickets();
    await openImportDialog();

    await screen.findByRole("list", { name: "导入历史" });
    expect(screen.getAllByRole("button", { name: "撤销" })).toHaveLength(1);
  });

  it("double-confirms and posts the revocation, then reports the removed count", async () => {
    auth.user = userWith(REVOKER);
    importBatches.items = [batchItem()];
    renderTickets();
    await openImportDialog();

    fireEvent.click(await screen.findByRole("button", { name: "撤销" }));
    const confirm = await screen.findByRole("dialog", { name: "撤销导入" });
    expect(confirm).toHaveTextContent("七月批次.xlsx");
    expect(revokeCalls()).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "确认撤销" }));

    await waitFor(() => expect(revokeCalls()).toHaveLength(1));
    expect(revokeCalls()[0]).toEqual({
      path: "ticket.revokeImportBatch",
      input: { batchId: "batch-1" },
    });
    await waitFor(() =>
      expect(toastSpies.success).toHaveBeenCalledWith("已撤销导入，42 条工单已删除"),
    );
  });
});
