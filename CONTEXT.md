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
工单生命周期中的操作事件记录。每次对工单的操作（分配、跟进、状态变更等）都会产生一条记录。

**操作类型**：
- `create`：创建工单
- `assign`：分配/改派责任人
- `status_change`：状态变更
- `comment`：添加跟进备注（触发联系次数 +1）
- `upload`：上传材料
- `export`：导出工单
- `resolve`：确认完结

### Assignee（责任人）
被分配处理特定工单的用户。一个工单同一时间只能有一个责任人，但可以改派。

### Follower（跟进人）
当前工单的责任人（assigneeId 对应的用户）。当工单改派时，跟进人随之变更。

**统计规则**：
- 工单的所有统计数据（进单、完单、超时）归属于**当前责任人**
- 改派后，原责任人不再计入该工单的统计
- 数据看板的"跟进人统计表"基于工单的当前 assigneeId 计算

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

## 业务规则

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
