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
- 处理时限：dueAt（从**录入时间 createdAt** + 投诉等级对应超时时长；特急不设）

**dueAt 计算规则**（基于**投诉等级**，非 priority；时钟从 **createdAt 录入时刻**起算，非分配时刻）：
- 一般投诉：createdAt + 48 小时
- 高级投诉：createdAt + 48 小时
- 加急投诉：createdAt + 72 小时
- 特急投诉：不设 dueAt（永不 overdue，靠每 12 小时跟进提醒持续驱动至完结）

**统一时钟**：所有 SLA 计时（首响、跟进检查点、滚动提醒、超时）都从 createdAt 起算。因此**未分配的工单也在消耗 SLA 时间**——工单可在 unassigned/assigned 状态下就首响超时或 overdue（此时 assigneeId 可能仍为 null）。这是有意为之，用于倒逼尽快分配。

### Channel（反馈渠道）
工单来源的业务渠道。系统预设 4 种固定渠道：
- 保司
- 经纪
- 支付
- 监管

不同渠道可能有不同的处理要求和排班配置。

### Priority（优先级）
独立的自由标签，默认空，可由处理人/主管手动赋值。**与 ComplaintLevel 无关，不驱动任何 SLA（不参与 dueAt/超时/首响计算）**，仅用于人工标注与排序参考。

### ComplaintLevel（投诉等级）
根据客户诉求的紧急程度和重要性分级。**决定首响时限、跟进频次、超时时长和提醒规则**（完整规则见 PRD §4.2，支持管理员配置）。

**首响 = 首次跟进**：首响和跟进都必须实际打电话联系客户才算。首响时刻 = 工单第一条 comment 的时间，无需额外字段。

**等级**（4 级）：
- 一般投诉：2 天 2 次跟进，2 小时内首响，超 48 小时算超时
- 高级投诉：2 天 3 次跟进，2 小时内首响，超 48 小时算超时
- 加急投诉：3 天 6 次跟进，1 小时内首响，超 72 小时算超时
- 特急投诉：至少 1 天 2 次跟进，30 分钟内触达，不设超时

### SLAPolicy（SLA 策略）
SLA 规则的结构化配置，按投诉等级各一条，管理员可编辑（全量可配置提醒引擎，见 ADR 0005）。含首响时限、超时时长、以及一个可增删的类型化提醒规则列表。

**三种提醒规则类型**：
- `first_response`：首响提醒（createdAt 起 N 分钟无首响则提醒）
- `follow_up_checkpoint`：跟进检查点（到某时间点前累计跟进不足则提醒，含提前量）
- `rolling_follow_up`：滚动提醒（特急专用，距上次跟进每 N 小时提醒）

完整字段与各级默认值见 PRD §3.8。运行时由后台定时任务扫描生成通知（见 ADR 0004）。

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

**操作类型**（7 种）：
- `create`：创建工单
- `assign`：分配/改派责任人
- `status_change`：状态变更
- `comment`：添加跟进备注（触发联系次数 +1）
- `upload`：上传材料
- `resolve`：确认完结
- `edit`：编辑工单基本信息（记录改动字段）

**from / to 字段约定**：
- `assign`：存**责任人姓名快照**（如 from="小王", to="小李"），不存 ID
- `status_change`：存状态枚举值（如 from="assigned", to="processing"）
- `edit`：多字段改动记在 remark（如"投诉等级: 一般投诉→加急投诉"），from/to 留空
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
- **平均完结时长**：completionTime − **createdAt** 的平均值（处理时效，端到端时长）
- **超时单数 / 超时率**：该客服名下**曾经超时**的工单数及占比（**含超时完结**：completionTime > dueAt，或在途 now > dueAt）（超时情况）

**设计要点**：
- 工单完结后 assigneeId 不再变化，"完结人"即为"完结时的责任人"，归属永久冻结
- 完单、时效、超时三个维度都围绕"完结"这一唯一动作，天然无重复、无遗漏
- **处理时效是端到端口径**（从 createdAt 算，与 SLA 时钟统一）：含派单延迟和改派前前任持有时长，衡量"工单进系统到解决的总时长"，非"当前客服单独速度"。取舍详见 ADR 0003
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
面向单个用户的站内提醒，共 3 种类型。分两类来源（详见 ADR 0004）：
- **用户操作触发**：`assigned`（被分配 / 改派工单时通知新责任人，覆盖首次分配与改派）—— 操作发生时同步生成，无需定时任务
- **时间流逝触发**：`overdue`（已超时）/ `due_soon`（快超时）—— 由后台定时任务扫描 dueAt 生成，接收人为当前 assigneeId

> 注：以下均**不产生通知**——
> - `comment`（添加跟进）：一单一责任人、无协作者，无合理接收人
> - 工单**状态变更**：要么由操作人自己触发、要么已被 assigned 通知覆盖
> - **新工单入库**：无接收人（未分配），主管靠看板"未分配数"主动处理，不推送

**送达方式**：前端每 30 秒轮询当前用户的未读通知（read = false），驱动红点 / toast。

## 业务规则

### 通知触发规则
- **assigned（操作触发）**：分配 / 改派工单时同步写入 AppNotification，targetUserId = 新责任人
- **overdue / due_soon（时间触发）**：后台定时任务周期扫描，targetUserId = 工单当前 assigneeId
  - **未分配工单（assigneeId=null）不发送提醒通知**——超时/预警靠看板呈现，主管主动处理
  - **去重（一单一类型一次）**：同一工单 + 同一通知类型（overdue / due_soon）**全生命周期只生成一次**。定时任务需记录"已发过"标记，后续扫描到同一工单同一类型直接跳过。用户即使漏看通知，看板红色标记会持续呈现
  - 扫描 SQL 与数据看板"已超时数 / 2小时预警数"复用同一时间判断条件

### 数据看板统计规则
**核心指标卡**（9个，均排除软删工单 deletedAt IS NULL）：
- 工单总数：所有工单
- 未分配数：status = `unassigned`
- 待处理数：status = `assigned`（已分配但未开始跟进）
- 处理中数：status = `processing`
- 已完结数：status = `completed`
- 2小时超时预警数：dueAt 距离当前时间不足 2 小时，且**未完结**（实时运营视角）
- 已超时数：dueAt < 当前时间，且**未完结**（实时运营视角，完结即移出；与考核"超时单数"口径不同——后者含超时完结，见 ADR 0003）
- 特急工单数：complaintLevel = 特急投诉
- 监管单数：channel = 监管

### 工单分配规则
- 工单可以创建时不分配责任人（assigneeId = null，status = unassigned）
- 工单可以手动分配给特定用户（需要 `ticket.assign` 权限）
- 工单可以根据排班自动分配
- 工单可以改派给其他用户（更新 assigneeId）
- **分配是主管/管理员的操作**：一线客服只能看到分配给自己的工单，看不到未分配池，不能自行认领（不设自领功能）
- **工单创建时**：即计算并设置 dueAt（createdAt + 投诉等级超时时长；特急不设）。SLA 时钟此刻起跑，与是否已分配无关
- **首次分配**：设置 assigneeId，记录 assignedAt，状态从 unassigned → assigned（**不改 dueAt**，dueAt 在创建时已定）
- **改派工单**：更新 assigneeId，dueAt 保持不变（createdAt 不变，dueAt 天然稳定）

### 自动分配规则（按排班）
- **触发**：主管手动点"按排班自动分配"（单个/批量），**不在工单创建时自动触发**
- **候选人**：该工单 channel 对应、当前时刻在班次内的在岗值班人（按 Schedule 匹配 channel + 班次时间覆盖当前）
- **选人**：候选人中在手工单（assigned + processing）最少者；平手随机
- **边界**：该 channel 当前无在岗值班人 → 不分配，提示主管手动处理

### 编辑与删除规则
- **编辑**（`ticket.edit`）：所有基本信息字段任意状态下（含已完结）均可改；**status 除外**（只能经生命周期动作流转，completed 不可重开）
- **改 complaintLevel 会重算 dueAt**（createdAt + 新等级超时时长）并切换 SLA 规则，可能立即改变 overdue/预警状态
- **编辑留痕**：每次编辑写一条 ProcessLog（action: edit）
- **删除**（`ticket.delete`）：**软删除**（设 deletedAt），默认列表与统计排除，ProcessLog/附件保留

### 状态流转规则
- `unassigned` → `assigned`：主管/管理员分配责任人
- `assigned` → `processing`：添加首次跟进记录时自动触发
- `assigned` → `completed`：可直接完结（无需处理的工单）
- `processing` → `completed`：正常完结流程
- 计算状态 `pending_timeout` 和 `overdue` 在前端查询时覆盖显示，不改变数据库中的基础状态

### 跟进频次规则
根据 ComplaintLevel 自动设置跟进频次要求（详见 PRD §4.2，支持管理员配置）：
- 一般投诉：2 天 2 次
- 高级投诉：2 天 3 次
- 加急投诉：3 天 6 次
- 特急投诉：至少 1 天 2 次

### 超时预警规则
- **dueAt 计算基准**：从工单**录入时间 createdAt** 开始计算，时长由投诉等级决定（未分配时也在计时）
- **2 小时预警**：距离 dueAt 不足 2 小时时，显示状态为 pending_timeout
- **已超时**：超过 dueAt 时，显示状态为 overdue（可能在 unassigned/assigned 状态下发生）
- **特急投诉不设 dueAt**：永不进入 pending_timeout / overdue
- **首响超时判断**：首响 = 第一条 comment。根据投诉等级的首响要求，从 **createdAt** 到第一条 comment 的时长判断是否超时首响

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
| 投诉等级 | ComplaintLevel | 一般/高级/加急/特急投诉 |
| 优先级 | Priority | 独立自由标签，默认空，与投诉等级无关 |
| 责任人 | Assignee | 被分配的处理人 |
| 跟进人 | Follower | 当前责任人（改派后随之变更）|
| 处理记录 | ProcessLog | 操作事件日志 |
| 完结状态 | CompletionStatus | 正常完结/冷处理等 |
| 排班 | Schedule | 值班安排 |
