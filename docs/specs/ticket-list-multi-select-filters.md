# 工单列表筛选多选化 & 归档工单默认隐藏

## 背景

历史工单通过 Excel 批量导入（`source=file_import`）后，`createdAt` 统一为导入瞬间，按 `createdAt desc` 排序时 907 条已完结历史单全部压在工单管理页最前，挤掉活跃工单。

已确认定位：导入入口**只用于历史归档**，导入的工单纯留痕（完结、无需 SLA、不再处理），不会用来批量创建活跃工单。

## 决策记录

| 决策点 | 结论 |
|---|---|
| 历史数据定位 | 纯归档（留痕/查询/导出），不再处理，不需要 SLA |
| 归档呈现方式 | 列表默认隐藏，筛选可见；不做独立归档页 |
| 归档标记方式 | 不加新字段、不加新状态，直接以 `source=file_import` 判定（导入入口仅用于归档，无歧义） |
| 多选范围 | 工单管理页**全部**筛选维度改多选：状态 / 反馈渠道 / 客诉类别 / 完结状态 / 投诉等级 / 来源 |
| 空选语义 | 空选 = 全部（不过滤）；来源的"默认排除 file_import"仅为**初始默认值**，用户清空后回落到不过滤 |
| 影响范围 | 只改工单列表查询与筛选 UI；详情页、仪表盘、逾期看板、通知计数、统计口径一律不动 |
| 导出 | 跟随列表当前筛选，即默认导出也不含归档单 |

## 改动清单

1. **shared**(`packages/shared/src/ticket.ts`)
   - `ticket.list` 查询 schema:`status / channelId / categoryId / completionStatusId / complaintLevel / source` 六字段单值 → 数组。
   - `source` 缺省 = `[feishu_form, manual, community]`（即排除 `file_import`)；其余字段缺省 = 不过滤。
   - 兼容旧链接：单值参数（如 `?source=manual`）宽容解析为单元素数组。

2. **api**(`apps/api/src/services/ticket.service.ts`)
   - 列表查询条件从 `equals` 改 `in`。
   - 导出复用同一查询逻辑，无需单独改动。

3. **web**(`apps/web/src/pages/tickets/TicketsPage.tsx`)
   - 六个 `FilterSelect` 单选 → 多选组件，带全选/清空快捷操作。
   - URL 参数逗号分隔多值（如 `status=Unassigned,Processing`)，仅在**偏离默认**时写入，默认状态 URL 保持干净。
   - 空选 = 全部（来源除外：初始默认不勾 file_import)。

4. **测试**
   - api：多选组合查询、source 缺省排除 file_import、显式传入 file_import 时返回归档单、旧单值参数兼容。
   - web：筛选多选交互、URL 参数序列化/反序列化、默认状态不显示归档单。

## 明确不做

- 数据库 schema 改动（零 migration）
- 新增"归档"字段/状态/概念
- 详情页、统计、仪表盘、通知的任何改动
