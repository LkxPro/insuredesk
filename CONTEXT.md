# 客服工单系统 - 领域模型

## 核心概念

### Ticket（工单）
客户通过各种渠道提交的服务请求（投诉、咨询、理赔等）。工单是系统的核心实体，包含完整的客户诉求信息、处理状态和处理历史。

**生命周期**：创建 → 未分配 → 已分配 → 处理中 → 已完结

**关键属性**：
- 唯一标识：workOrderNumber（如 WO202607000001）
- 业务信息：项目、保单号、客户信息
- 分类：渠道、类别、投诉等级
- 状态：status（unassigned/assigned/processing/completed）
- 责任人：assigneeId（可为空）
- 处理时限：dueAt（从分配时间 + 根据 priority 计算的时长）

**dueAt 计算规则**（基于 priority）：
- urgent：分配时间 + 24小时
- high：分配时间 + 3天
- medium：分配时间 + 7天
- low：不设置 dueAt

### Channel（反馈渠道）
工单来源的业务渠道。系统预设 4 种固定渠道：
- 保司
- 经纪
- 支付
- 监管

不同渠道可能有不同的处理要求和排班配置。

### ComplaintLevel（投诉等级）
根据客户诉求的紧急程度和重要性分级。决定跟进频次和首响时限。

**等级**（从低到高）：
- 一般工单：至少 3 天 1 次跟进，4 小时内首响
- 紧急工单：至少 1 天 1 次跟进，2 小时内首响
- 加急工单：至少 1 天 2 次跟进，1 小时内首响
- 特急工单：至少 1 天 2 次跟进，30 分钟内首响

### Status（工单状态）
工单当前所处的处理阶段。

**基础状态**（数据库存储）：
- `unassigned`：未分配（初始录入，assigneeId = null）
- `assigned`：已分配（已分配责任人，但未开始跟进）
- `processing`：处理中（已添加首次跟进记录）
- `completed`：已完结（人工标记完结）

**计算状态**（查询时根据 dueAt 和当前时间实时计算，覆盖基础状态显示）：
- `pending_timeout`：待超时（距离 dueAt 不足 2 小时，优先级高于基础状态）
- `overdue`：已超时（已超过 dueAt，优先级高于基础状态）

**状态流转**：
unassigned → assigned → processing → completed
                ↓            ↓
         (计算: pending_timeout / overdue)

### ProcessLog（处理记录）
工单生命周期中的操作事件记录。每次对工单的操作（分配、跟进、状态变更等）都会产生一条记录，构成工单详情页的时间线。ProcessLog 本质是审计日志，记录"当时发生的事实"。

**操作类型**（6 种）：
- `create`：创建工单
- `assign`：分配/认领/改派责任人
- `status_change`：状态变更
- `comment`：添加跟进备注（触发联系次数 +1）
- `upload`：上传材料
- `resolve`：确认完结

**from / to 字段约定**：
- `assign`：存**责任人姓名快照**（如 from="小王", to="小李"），不存 ID
- `status_change`：存状态枚举值（如 from="assigned", to="processing"）
- 存姓名快照而非 ID：ProcessLog 不承担考核统计职责（考核走 tickets.assigneeId，见 ADR 0003），仅服务时间线展示；姓名快照能忠实反映"当时是谁"，即使用户后续改名/离职

**记录生成规则**：
- **状态变更一律独立记录**：凡 status 发生变化，都额外单独写一条 status_change（记 from/to 状态枚举），无例外。这意味着：
  - 首次 comment 触发 assigned → processing：写 comment + status_change 两条
  - resolve 触发 → completed：写 resolve + status_change 两条
  - assign 触发 unassigned → assigned：写 assign + status_change 两条
- 导出操作**不**产生 ProcessLog（导出是列表级批量操作，不属于单工单时间线）

### Assignee（责任人）
被分配处理特定工单的用户。一个工单同一时间只能有一个责任人，但可以改派。

### Follower（跟进人）
当前工单的责任人（assigneeId 对应的用户）。当工单改派时，跟进人随之变更。

**统计规则**：
- 工单的所有统计数据归属于**当前责任人**（当前 assigneeId）
- 改派后，原责任人不再计入该工单的统计
- 数据看板的"跟进人考核表"基于工单的当前 assigneeId 计算

### 客服考核维度
客服绩效考核围绕"完结结果 + 当前责任"，共 3 个维度，均按当前 assigneeId 归属，不追踪改派历史。

**考核表列**（跟进人考核表）：
- **完单数**：当前 assigneeId = 该客服 且 status = completed 的工单数（处理单量）
- **平均完结时长**：completionTime - assignedAt 的平均值（处理时效）
- **超时单数 / 超时率**：该客服名下已超时（含超时完结）的工单数及占比（超时情况）

**设计要点**：
- 工单完结后 assigneeId 不再变化，"完结人"即为"完结时的责任人"，归属永久冻结
- 完单、时效、超时三个维度都围绕"完结"这一唯一动作，天然无重复、无遗漏
- **不统计转单数**：转走且未完结的工单不算业绩产出；改派记录在工单 ProcessLog 时间线中可查
- **已知取舍**：不追踪转单历史意味着"超时那一刻持有工单的人"承担超时；理论上存在"甩单"漏洞，争议时以 ProcessLog 为准

### User（用户）
系统的使用者。根据角色拥有不同的权限。

**典型角色**：
- 管理员：全部权限
- 客服主管：分配、监控、导出
- 一线客服：处理自己的工单
- 只读观察员：仅查看

### Schedule（排班）
按日期、班次、渠道配置的值班安排。用于自动分配工单或快速查找当班责任人。

**班次**：
- 早班（day）：09:00-18:00
- 晚班（night）：12:00-21:00

### Attachment（附件）
工单处理过程中上传的文件材料（证明文件、沟通记录等）。

### Notification（通知 / AppNotification）
面向单个用户的站内提醒。分两类来源（详见 ADR 0004）：
- **用户操作触发**：new_ticket / assign / reassigned / comment / status_change —— 操作发生时同步生成，无需定时任务
- **时间流逝触发**：overdue / due_soon —— 由后台定时任务扫描 dueAt 生成

**送达方式**：前端每 30 秒轮询当前用户的未读通知（read = false），驱动红点 / toast。

## 业务规则

### 通知触发规则
- **用户操作触发类**：在处理对应操作的业务逻辑中同步写入 AppNotification，targetUserId 为通知接收人
  - 分配 / 改派：接收人为新责任人
  - comment / status_change：接收人待细化（发给谁尚未定义）
- **时间流逝触发类**（overdue / due_soon）：后台定时任务周期扫描，接收人为工单当前 assigneeId
  - 需去重：同一工单 + 同一通知类型不重复生成（规则待细化）
  - 扫描 SQL 与数据看板"已超时数 / 2小时预警数"复用同一时间判断条件
- new_ticket 在工单未分配时的接收人（发给谁）待细化

### 数据看板统计规则
**核心指标卡**（9个）：
- 工单总数：所有工单
- 未分配数：status = `unassigned`
- 待处理数：status = `assigned`（已分配但未开始跟进）
- 处理中数：status = `processing`
- 已完结数：status = `completed`
- 2小时超时预警数：dueAt 距离当前时间不足 2 小时，且未完结
- 已超时数：dueAt < 当前时间，且未完结
- 特级工单数：complaintLevel = 特急工单
- 监管单数：channel = 监管

### 工单分配规则
- 工单可以创建时不分配责任人（assigneeId = null，status = unassigned）
- 工单可以手动分配给特定用户（需要 `ticket.assign` 权限）
- 工单可以根据排班自动分配
- 工单可以改派给其他用户（更新 assigneeId）
- **工单可以自行认领**：用户可以认领未分配的工单（需要 `ticket.claim` 权限），认领时自动设置 assigneeId 为当前用户
- **首次分配**：设置 assigneeId，状态从 unassigned → assigned，计算并设置 dueAt
- **改派工单**：更新 assigneeId，dueAt 保持不变（不重新计算）

### 状态流转规则
- `unassigned` → `assigned`：分配责任人（手动分配或自行认领）
- `assigned` → `processing`：添加首次跟进记录时自动触发
- `unassigned` → `processing`：认领工单并直接添加跟进记录（跳过 assigned 状态）
- `assigned` → `completed`：可直接完结（无需处理的工单）
- `processing` → `completed`：正常完结流程
- 计算状态 `pending_timeout` 和 `overdue` 在前端查询时覆盖显示，不改变数据库中的基础状态

### 跟进频次规则
根据 ComplaintLevel 自动设置跟进频次要求：
- 一般工单：3 天 1 次
- 紧急工单：1 天 1 次
- 加急工单：1 天 2 次
- 特急工单：1 天 2 次

### 超时预警规则
- **dueAt 计算基准**：从工单分配时间开始计算（状态从 unassigned → assigned 的时刻）
- **2 小时预警**：距离 dueAt 不足 2 小时时，显示状态为 pending_timeout
- **已超时**：超过 dueAt 时，显示状态为 overdue
- **首响超时判断**：根据投诉等级的首响要求，从分配时间开始计算

### 完结规则
完结时需要选择 completionStatus（完结原因），所有 completionStatus 都表示工单进入最终的 completed 状态，不可重新打开。

**完结状态枚举**（12 种）：
- 未取得有效联系
- 已达成一致
- 诉求过高，无法达成一致
- 客户自行撤诉
- 已协商解决
- 已赔付
- 已退保
- 转其他部门处理
- 无效工单
- 正常完结
- 冷处理
- 联系不上

**完结时的系统行为**：
- 设置 status = `completed`
- 记录 completionTime（完结时间戳）
- 添加 ProcessLog（action: resolve）

## 术语对照

| 中文 | 英文 | 说明 |
|------|------|------|
| 工单 | Ticket | 核心实体 |
| 工单号 | workOrderNumber | 业务标识 |
| 反馈渠道 | Channel | 保司/经纪/支付/监管 |
| 投诉等级 | ComplaintLevel | 一般/紧急/加急/特急 |
| 责任人 | Assignee | 被分配的处理人 |
| 跟进人 | Follower | 最后一次处理的人 |
| 处理记录 | ProcessLog | 操作事件日志 |
| 完结状态 | CompletionStatus | 正常完结/冷处理等 |
| 排班 | Schedule | 值班安排 |
