---
name: release-prepare
description: 起草本版本 changelog 条目并完成发版准备（素材 → 条目 → 截图 → changelog PR）。在 make release-prepare 产出素材包与草稿 yaml 后使用。
---

# 起草 changelog 并完成发版准备

## 输入

`make release-prepare` 已产出：

- `.release-prepare/v<版本>/materials.md`：上一版本以来已合并的 PR、关闭的 issue、
  apps/web 路由 diff
- `changelog/v<版本>.yaml`：已填 version/date、entries 为空的草稿

## 职责

1. 读素材包，逐条 PR/issue 判断是否构成本版本的用户可见变化，按分类词汇归类。
   分类只允许四个字面量：`新增`（新能力）、`改进`（既有能力变好）、`修复`（修 bug）、
   `内部`（无用户可见变化：升级依赖、重构、内部工具等）。内部变更一律
   `category: 内部`。
2. 为每条入选变化撰写双级中文文案（字段语义见 `changelog/README.md`）：
   - `user`：给用户看的一句话摘要，渲染进应用内更新提示
   - `full`：完整说明，渲染进日志详情页与 GitHub Release notes
   - 以用户视角陈述变化与影响，不照抄 PR 标题，不堆砌实现细节
3. 决定截图：有用户可见页面变化才配截图——填 `page`（站内路由，`/` 开头，必须
   真实存在；用素材包的路由 diff 与 `apps/web/src/AppRoutes.tsx` 核对）与
   `screenshot`（ASCII 文件名，见 `changelog/README.md` 命名规则）。纯后端与
   内部条目不配 page/screenshot。
4. 需要演示数据时，按条目语境决定 mock 数据，写 setup 钩子灌入：
   `changelog/v<版本>/<截图名去掉 .png>.setup.ts`，截图器在截该页面前自动执行。
   钩子经环境变量拿到运行上下文：`INSUREDESK_WEB_URL`（站点）、
   `INSUREDESK_API_URL`（API）、`DATABASE_URL`（数据库）；样例见
   `changelog/fixtures/screenshot/v2099.06.0/tickets-list.setup.ts`。
   mock 数据要贴合条目语境——截筛选器就先造出可筛出差异的多渠道工单，空页面
   截图没有信息量。
   静态页面呈现不出的状态（如展开的下拉），另写同名 `.page.ts` 交互钩子，
   默认导出 `async (page: Page) => Promise<void>`，截图器在 goto 之后、截图
   之前把 Playwright 页面交给它；样例见
   `changelog/v2026.08.5/tickets-combobox-search.page.ts`。
5. `date` 是预计发布日，默认草稿生成当天；发布日变更时顺手改。

## 完成

1. 自验：`node scripts/changelog/validate.ts changelog/v<版本>.yaml`
2. 确认本地 dev 栈在跑（`make dev`），然后重跑 `make release-prepare`：
   校验 → 调截图器产出 PNG → 以 PR 形式提交 yaml + PNG。
   注意：vite 的 eager glob 不热更 `changelog/` 下新增文件——dev 栈若起在
   yaml 创建之前，页面拿不到新版本（截图会截出旧状态甚至空态），先重启 dev 栈再截。
3. 报告 PR 链接，提醒：人工过目 merge 后，在 main 上 `make release` 触发发布

## 边界

- 不补录历史版本 changelog，不动生产部署/升级流程
- 条目只覆盖素材包区间内已合并的变化；未合并的 PR 不写
