# Changelog

面向用户的更新日志。每个发版一个文件，由 release-prepare 流程生成并随版本提交。

## 文件命名

`changelog/v<版本>.yaml`，版本号为发版 CalVer `v<年>.<月>.<序号>`（同
`docs/releasing.md`，如 `v2026.08.0`）。文件内 `version` 字段必须与文件名一致。

## 字段

```yaml
version: v2026.08.0 # 与文件名一致
date: 2026-08-16 # 发布日期，ISO 日历日
entries: # 至少一条
  - category: 新增 # 分类，取值见下
    user: 工单列表支持按渠道筛选 # 给用户看的一句话，渲染进更新提示
    full: 工单列表页新增渠道筛选器，支持多选与清空。 # 完整说明，渲染进日志详情
    page: /tickets # 可选，相关站内路由（以 / 开头），截图与跳转用
    screenshot: tickets-filter.png # 可选，截图文件名，见下
```

- `user` / `full` 都面向用户，均必填；`user` 是一句话摘要，`full` 是可展开的完整描述。
- `page`、`screenshot` 可选；未知字段视为错误（防笔误）。

## 分类词汇

只允许四个字面量：`新增`（新能力）、`改进`（既有能力变好）、`修复`（修 bug）、
`内部`（无用户可见变化，升级依赖、重构等）。

## 截图

条目带 `screenshot` 时，PNG 放在与版本同名的目录：`changelog/v<版本>/<文件名>.png`。
文件名限 ASCII 字母数字与 `._-`，不得以路径形式引用（校验器拒绝含 `/` 的取值），
引用的文件必须随 yaml 一同提交。

每张截图可配两个同名钩子：`<文件名>.setup.ts`（截图前灌演示数据，子进程执行）
与 `<文件名>.page.ts`（goto 后截图前拿到 Playwright 页面做交互，如展开下拉）。

## 校验

```bash
node scripts/changelog/validate.ts            # 校验 changelog/ 顶层全部 v*.yaml
node scripts/changelog/validate.ts <文件...>  # 校验指定文件
```

校验内容：schema 合规（含分类取值）、`version` 与文件名一致、`screenshot` 引用的
PNG 存在；错误报具体字段与行列号。CI（`scripts/ci.sh`）必跑。合法/非法样例见
`changelog/fixtures/`。

数据契约的 zod schema 在 `@insuredesk/shared`（`changelogFileSchema` 等），前后端与
脚本共用同一定义。
