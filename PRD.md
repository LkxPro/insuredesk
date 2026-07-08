# 客服工单系统 PRD（产品需求文档）

## 1. 产品概述

### 1.1 产品定位
保险行业客服工单管理系统，用于统一管理来自多个渠道的客户投诉、咨询、理赔等服务请求，实现工单全生命周期跟踪、自动化流转、SLA监控和数据分析。

### 1.2 核心价值
- **多渠道统一受理**：整合保司、经纪、支付、监管等多个反馈渠道
- **智能分级跟进**：基于投诉等级自动设置跟进频次和首响要求
- **实时预警监控**：2小时超时预警、已超时工单提醒
- **数据驱动决策**：多维度统计分析，支持按渠道、跟进人等维度查看
- **权限精细管控**：支持管理员、主管、客服、观察员等多角色权限

### 1.3 目标用户
- **一线客服**：处理分配给自己的工单，添加跟进记录
- **客服主管**：分配工单、监控团队数据、导出报表
- **管理员**：系统配置、权限管理、全局数据查看
- **观察员**：只读查看工单和数据统计

---

## 2. 核心功能模块

### 2.1 工单管理
- **工单列表**：支持多维度筛选、排序、搜索
- **工单详情**：查看完整工单信息、处理记录时间线
- **新增工单**：手动创建工单（支持飞书表单自动导入）
- **分配工单**：单个/批量分配给责任人
- **处理工单**：添加跟进记录、上传材料、设置下次联系时间
- **完结工单**：选择完结类型（正常完结/冷处理/联系不上）
- **导出工单**：按筛选条件导出 Excel/CSV

### 2.2 数据看板
- **8 个核心指标卡**
  - 工单总数
  - 待处理数
  - 处理中数
  - 已完结数
  - 2小时超时预警数
  - 已超时数
  - 特级工单数
  - 监管单数
- **渠道统计表**：4 个渠道（保司/经纪/支付/监管）的工单分布
- **跟进人统计表**：Top 10 跟进人的进单、完单、超时数据
- **智能建议**：根据数据自动生成运营建议

### 2.3 用户与权限
- **用户管理**：新增、编辑、禁用用户，分配角色
- **角色管理**：自定义角色，配置页面、数据、操作权限
- **权限体系**：
  - 页面权限：访问特定页面
  - 数据权限：查看全部/团队/个人工单
  - 操作权限：新增、编辑、分配、导出等

### 2.4 排班配置
- **排班日历**：按日期、班次、渠道配置值班人员
- **班次类型**：早班（9:00-18:00）、中班（12:00-21:00）、晚班（18:00-03:00）
- **渠道绑定**：支持按渠道配置不同的值班人

### 2.5 外部能力（扩展）
- **飞书表单集成**：自动同步飞书表单提交的工单
- **定时导出策略**：配置每日/每周自动导出特定渠道工单
- **通知推送**：工单分配、状态变更、超时预警等消息推送

---

## 3. 数据模型

### 3.1 工单（Ticket）

#### 3.1.1 基本信息
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | ✅ | 工单ID（系统生成，如 T0001） |
| workOrderNumber | string | ✅ | 工单号（格式：WO202607xxxxx） |
| createdAt | ISO 8601 | ✅ | 创建时间 |
| updatedAt | ISO 8601 | ✅ | 更新时间 |
| feedbackTime | ISO 8601 | ✅ | 反馈时间（客户实际反馈时间） |

#### 3.1.2 来源与渠道
| 字段 | 类型 | 必填 | 枚举值 | 说明 |
|------|------|------|--------|------|
| source | enum | ✅ | feishu_form / manual / community | 工单来源 |
| channel | enum | ✅ | 保司 / 经纪 / 支付 / 监管 | 反馈渠道（4种） |

#### 3.1.3 业务信息
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| project | string | ✅ | 项目（保司名称，如：融盛、泰康、平安） |
| brokerageEntity | string | ✅ | 经纪主体（如：东方大地、华泰保险经纪） |
| paymentChannel | string | ✅ | 支付渠道（如：连连支付、支付宝） |
| internalOrderNumber | string | ❌ | 内部订单号（非必填） |
| policyNumber | string | ✅ | 保单号 |
| userComplaintChannel | string | ✅ | 用户投诉渠道（手动填写，如：飞书投诉、400热线） |

#### 3.1.4 客户信息
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| customerName | string | ✅ | 客户姓名 |
| phone | string | ✅ | 客户电话（投保人） |
| contactPhone | string | ❌ | 联系人电话（备用） |
| customerRequest | string | ✅ | 客户诉求（文本） |
| nuclearBodyStatus | enum | ✅ | 保司侧是否核身：是 / 否 / 待核实 |
| hasContacted | boolean | ✅ | 客户是否曾进线 |
| contactId | string | ❌ | 进线ID（如果有） |

#### 3.1.5 分类与等级
| 字段 | 类型 | 必填 | 枚举值 | 说明 |
|------|------|------|--------|------|
| category | enum | ✅ | 见下表 | 客诉类别（17种） |
| complaintLevel | enum | ✅ | 一般工单 / 紧急工单 / 加急工单 / 特急工单 | 投诉等级 |
| priority | enum | ✅ | low / medium / high / urgent | 优先级 |
| followUpFrequency | string | ✅ | 跟进频次要求（根据投诉等级自动设置） |
| firstResponseRequirement | string | ✅ | 首响要求（根据投诉等级自动设置） |

**客诉类别（17种）**：
- 监管投诉-引导性
- 监管投诉-非引导性
- 投诉-服务态度
- 投诉-未履行告知义务
- 投诉-信息泄露
- 投诉-保费收取问题
- 理赔咨询
- 理赔投诉
- 退保申请
- 退保投诉
- 保单变更
- 保单查询
- 续保咨询
- 核保咨询
- 产品咨询
- 回访问题
- 其他

#### 3.1.6 处理状态
| 字段 | 类型 | 必填 | 枚举值 | 说明 |
|------|------|------|--------|------|
| status | enum | ✅ | unassigned / assigned / processing / completed | 工单状态（4个基础状态） |
| assigneeId | string | ❌ | - | 责任人ID（未分配为 null） |
| assignedAt | ISO 8601 | ❌ | - | 分配时间（首次分配时记录，用于计算 dueAt） |
| dueAt | ISO 8601 | ❌ | - | 处理时限（从 assignedAt + priority 对应时长，改派不重置） |
| nextContactTime | ISO 8601 | ❌ | - | 下次联系时间 |
| contactCount | number | ✅ | - | 联系次数（每次添加跟进记录 +1） |
| follower | string | ✅ | - | 跟进人姓名（当前责任人姓名） |
| processingResult | string | ✅ | - | 处理结果（最后一条跟进记录） |

**状态说明**：
- `unassigned`：未分配（初始录入，assigneeId = null）
- `assigned`：已分配（已分配责任人，但未添加首次跟进记录）
- `processing`：处理中（已添加首次跟进记录）
- `completed`：已完结（人工标记完结）
- `pending_timeout`：待超时（计算状态，距离 dueAt 不足 2 小时，前端显示用）
- `overdue`：已超时（计算状态，已超过 dueAt，前端显示用）

**重要**：`pending_timeout` 和 `overdue` 是查询时根据 dueAt 实时计算的显示状态，不存储在数据库中。

#### 3.1.7 完结信息
| 字段 | 类型 | 必填 | 枚举值 | 说明 |
|------|------|------|--------|------|
| completionTime | ISO 8601 | ❌ | - | 完结时间 |
| completionStatus | enum | ❌ | 正常完结 / 冷处理 / 联系不上 等 | 完结状态（共12种，见附录9.1） |

#### 3.1.8 创建人信息
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| creator | string | ✅ | 创建人ID（外部填写默认为 "外部"） |
| creatorName | string | ✅ | 创建人姓名 |
| submitterName | string | ✅ | 提交人姓名 |

#### 3.1.9 关联数据
| 字段 | 类型 | 说明 |
|------|------|------|
| processLogs | ProcessLog[] | 处理记录列表 |
| attachments | Attachment[] | 附件列表 |

---

### 3.2 处理记录（ProcessLog）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | ✅ | 记录ID |
| operatorId | string | ✅ | 操作人ID |
| operatorName | string | ❌ | 操作人姓名（冗余存储） |
| operatorAvatar | string | ❌ | 操作人头像 |
| action | enum | ✅ | create / assign / status_change / comment / upload / export / resolve |
| from | string | ❌ | 变更前的值（状态变更/分配时使用） |
| to | string | ❌ | 变更后的值 |
| remark | string | ✅ | 备注说明 |
| attachments | Attachment[] | ❌ | 本次操作上传的材料 |
| at | ISO 8601 | ✅ | 操作时间 |

**操作类型说明**：
- `create`：创建工单
- `assign`：分配/改派责任人
- `status_change`：状态变更
- `comment`：添加处理备注（联系次数 +1）
- `upload`：上传材料
- `export`：导出工单
- `resolve`：确认完结

---

### 3.3 附件（Attachment）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | ✅ | 附件ID |
| name | string | ✅ | 文件名 |
| type | string | ✅ | MIME 类型 |
| url | string | ✅ | 文件URL |

---

### 3.4 用户（User）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | ✅ | 用户ID |
| name | string | ✅ | 姓名 |
| email | string | ✅ | 邮箱 |
| roleId | string | ✅ | 角色ID |
| team | string | ✅ | 所属团队 |
| active | boolean | ✅ | 是否启用 |

---

### 3.5 角色（Role）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | ✅ | 角色ID |
| name | string | ✅ | 角色名称 |
| permissions | string[] | ✅ | 权限点列表 |

**预设角色**：
- **管理员**：全部权限
- **客服主管**：除权限管理外的全部权限
- **一线客服**：查看、新增、编辑、处理工单
- **只读观察**：仅查看工单和数据看板

---

### 3.6 排班（Schedule）

| 字段 | 类型 | 必填 | 枚举值 | 说明 |
|------|------|------|--------|------|
| id | string | ✅ | - | 排班ID |
| userId | string | ✅ | - | 用户ID |
| date | string | ✅ | YYYY-MM-DD | 日期 |
| shift | enum | ✅ | day / mid / night | 班次类型 |
| startTime | string | ✅ | HH:mm | 开始时间 |
| endTime | string | ✅ | HH:mm | 结束时间 |
| channel | string | ✅ | - | 负责渠道 |
| remark | string | ❌ | - | 备注 |

**班次配置**：
- **早班（day）**：09:00-18:00
- **晚班（night）**：12:00-21:00

---

### 3.7 通知（AppNotification）

| 字段 | 类型 | 必填 | 枚举值 | 说明 |
|------|------|------|--------|------|
| id | string | ✅ | - | 通知ID |
| type | enum | ✅ | new_ticket / status_change / overdue / due_soon / reassigned / comment | 通知类型 |
| title | string | ✅ | - | 通知标题 |
| content | string | ✅ | - | 通知内容 |
| ticketId | string | ❌ | - | 关联工单ID |
| workOrderNumber | string | ❌ | - | 工单号 |
| targetUserId | string | ✅ | - | 目标用户ID |
| read | boolean | ✅ | - | 是否已读 |
| createdAt | ISO 8601 | ✅ | - | 创建时间 |

---

## 4. 业务流程

### 4.1 工单生命周期

```
[创建] → [未分配 unassigned] → [已分配 assigned] → [处理中 processing] → [已完结 completed]
                                        ↓                    ↓
                               (计算状态: pending_timeout / overdue)
```

**状态说明**：
- **unassigned**：未分配（新建工单，assigneeId = null）
- **assigned**：已分配（已分配责任人，但未开始跟进）
- **processing**：处理中（已添加首次跟进记录）
- **completed**：已完结（人工标记完结）
- **pending_timeout**：待超时（计算状态，距离 dueAt 不足 2 小时）
- **overdue**：已超时（计算状态，已超过 dueAt）

**状态流转规则**：
- unassigned → assigned：分配责任人（手动分配或自行认领）
- assigned → processing：添加首次跟进记录时自动触发
- unassigned → processing：认领并直接添加跟进（跳过 assigned）
- assigned → completed / processing → completed：完结工单
- pending_timeout 和 overdue 是前端查询时实时计算的显示状态，覆盖基础状态显示，不改变数据库中的 status 字段

### 4.2 投诉等级跟进规则

| 等级 | 跟进频次 | 首响要求 | 完结条件 |
|------|----------|----------|----------|
| 一般工单 | 至少3天1次 | 分派后4小时内触达 | 冷处理超过15天后未出现新反馈内容后办结 |
| 紧急工单 | 至少1天1次 | 分派后2小时内触达 | 冷处理超过10天后未出现新反馈内容后办结 |
| 加急工单 | 至少1天2次 | 分派后1小时内触达 | 诉求过高无法满足，经反馈上级后评估冷处理 |
| 特急工单 | 至少一天2次 | 分派后30分钟内触达 | 冷处理超过7天后未出现新反馈内容后办结 |

**提醒规则示例**（特急工单）：
1. 15分钟内未首响提醒
2. 24小时内没有出现2次跟进记录提醒（提前1小时）
3. 48小时内未4次跟进提醒（提前3小时）
4. 未完结前每距离上一次跟进12小时提醒

### 4.3 工单分配流程

1. **手动分配**：
   - 主管/管理员选择工单 → 选择责任人 → 确认分配
   - 系统自动：
     - 更新 assigneeId
     - 记录 assignedAt（首次分配时）
     - 计算并设置 dueAt（assignedAt + priority 对应时长）
     - 状态从 unassigned 变更为 assigned
     - 添加处理记录（action: assign）
     - 推送通知给责任人

2. **自行认领**：
   - 客服在工单列表看到未分配工单（需要 `ticket.claim` 权限）
   - 点击"认领"按钮
   - 系统自动：
     - 设置 assigneeId = 当前用户
     - 记录 assignedAt
     - 计算并设置 dueAt
     - 状态从 unassigned 变更为 assigned
     - 添加处理记录（action: assign）

3. **改派工单**：
   - 主管选择已分配的工单 → 选择新责任人 → 确认改派
   - 系统自动：
     - 更新 assigneeId 为新责任人
     - **dueAt 保持不变**（不重新计算）
     - assignedAt 保持不变
     - 添加处理记录（action: assign，记录从谁改派到谁）
     - 推送通知给新责任人（标注剩余时间）

4. **批量分配**：
   - 支持多选工单 → 统一分配给同一责任人
   - 或根据排班自动分配

### 4.4 工单处理流程

1. **开始处理**：
   - 责任人查看工单详情
   - 添加处理备注（联系客户情况）
   - 上传处理材料（可选）
   - 系统自动：
     - 联系次数 +1
     - 添加处理记录（action: comment）
     - 更新 processingResult 为最新备注
     - 状态自动从 assigned 变为 processing（首次跟进时）

2. **持续跟进**：
   - 根据投诉等级要求定期跟进
   - 设置下次联系时间
   - 系统根据规则发送提醒

3. **完结工单**：
   - 选择完结类型（completionStatus）：
     - 正常完结
     - 冷处理
     - 联系不上
     - 其他（共 12 种，见附录 9.1）
   - 填写完结备注
   - 系统自动：
     - 状态变更为 completed
     - 记录 completionTime
     - 添加处理记录（action: resolve）

**重要说明**：
- 首次跟进（添加第一条 action=comment 的记录）会自动触发 assigned → processing 状态变更
- 改派工单后，新责任人的首次跟进也会触发状态变更（如果工单还在 assigned 状态）

---

## 5. 权限设计

### 5.1 权限点定义

#### 5.1.1 数据看板
- `dashboard.view`：访问数据看板（页面权限）
- `dashboard.view_all`：查看全部数据（数据权限）
- `dashboard.export`：导出数据报表（操作权限）

#### 5.1.2 工单管理
- `ticket.view`：访问工单列表（页面权限）
- `ticket.view_all`：查看全部工单（数据权限）
- `ticket.view_team`：查看团队工单（数据权限）
- `ticket.create`：新增工单（操作权限）
- `ticket.edit`：编辑工单基本信息（操作权限）
- `ticket.process`：处理工单（操作权限）
- `ticket.assign`：分配工单（操作权限）
- `ticket.claim`：自行认领未分配工单（操作权限）
- `ticket.batch_assign`：批量分配（操作权限）
- `ticket.export`：导出工单（操作权限）
- `ticket.delete`：删除工单（操作权限，危险）

#### 5.1.3 用户管理
- `user.view`：访问用户管理（页面权限）
- `user.create`：新增用户（操作权限）
- `user.edit`：编辑用户（操作权限）
- `user.delete`：删除用户（操作权限）
- `user.assign_role`：分配角色（操作权限）

#### 5.1.4 角色权限
- `role.view`：访问角色管理（页面权限）
- `role.create`：新增角色（操作权限）
- `role.edit`：编辑角色（操作权限）
- `role.delete`：删除角色（操作权限）
- `role.edit_permission`：编辑权限配置（操作权限）

#### 5.1.5 系统配置
- `schedule.view`：访问排班配置（页面权限）
- `schedule.edit`：编辑排班（操作权限）

### 5.2 数据权限隔离

| 角色 | 数据范围 | 说明 |
|------|----------|------|
| 管理员 | 全部工单 | 可查看所有人的工单 |
| 客服主管 | 团队工单 | 只能查看本团队成员的工单 |
| 一线客服 | 个人工单 | 只能查看分配给自己的工单 |
| 只读观察 | 根据配置 | 可配置查看范围 |

---

## 6. 非功能需求

### 6.1 性能要求
- 工单列表加载时间 < 1秒（100条数据）
- 数据看板统计计算时间 < 2秒
- 支持并发用户数：50+

### 6.2 数据安全
- 敏感信息加密存储（客户电话、保单号）
- 操作日志完整记录（谁、何时、做了什么）
- 数据导出需权限校验

### 6.3 可用性
- 系统可用性：99%
- 支持主流浏览器（Chrome、Edge、Safari）
- 响应式设计，支持平板访问

### 6.4 扩展性
- 支持飞书表单集成（Webhook）
- 支持对接外部客户进线系统
- 支持对接短信/邮件通知服务
- 支持定时任务（超时提醒、自动导出）

---

## 7. 技术约束

### 7.1 前端技术栈
- 框架：React 18+ / Vue 3+
- UI库：Ant Design / Element Plus
- 状态管理：根据需要选择（Redux / Pinia / Zustand）
- 路由：React Router / Vue Router
- 构建工具：Vite / Webpack

### 7.2 后端技术栈（待定）
- 语言：Node.js / Java / Go / Python
- 数据库：PostgreSQL / MySQL
- 缓存：Redis
- 对象存储：阿里云 OSS / 腾讯云 COS（附件存储）

### 7.3 部署要求
- 支持 Docker 容器化部署
- 支持 Nginx 反向代理
- 支持 HTTPS

---

## 8. 后续迭代方向

### 8.1 智能化能力
- 工单智能分类（基于客户诉求自动识别类别）
- 智能推荐责任人（基于历史处理数据）
- 客户情绪分析（识别高危投诉）

### 8.2 协同能力
- 工单内部协作（@提及、评论）
- 工单转派流程优化
- 团队消息中心

### 8.3 报表能力
- 自定义报表配置
- 多维度数据分析（按时间段、渠道、类别等）
- 客服绩效考核报表

### 8.4 移动端
- 移动端 H5 适配
- 小程序版本
- 消息推送（企业微信/钉钉）

---

## 9. 附录

### 9.1 完结状态枚举（完整列表）
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

### 9.2 优先级与处理时限映射

dueAt 从分配时间（assignedAt）开始计算：

| 优先级 | 处理时限（dueAt） |
|--------|-------------------|
| urgent | assignedAt + 24小时 |
| high   | assignedAt + 3天 |
| medium | assignedAt + 7天 |
| low    | 不设置 dueAt |

**重要说明**：
- dueAt 在首次分配时计算并设置
- 改派工单时，dueAt 保持不变（不重新计算）
- 这确保了对客户的时限承诺不会因内部改派而延长

### 9.3 工单号生成规则
格式：`WO + 年（4位）+ 月（2位）+ 流水号（5位）`

示例：`WO202607000001`

---

## 变更记录

| 版本 | 日期 | 修订内容 | 修订人 |
|------|------|----------|--------|
| v1.0 | 2026-07-08 | 初始版本，基于 legacy demo 整理 | - |
| v1.1 | 2026-07-08 | 领域模型优化：<br>1. 工单状态从 3 个改为 4 个基础状态（unassigned/assigned/processing/completed）<br>2. 明确 pending_timeout 和 overdue 为计算状态，不存储数据库<br>3. dueAt 从分配时间计算，改派时保持不变<br>4. 新增 assignedAt 字段记录分配时间<br>5. 新增 ticket.claim 权限支持自行认领<br>6. 明确跟进人统计归属于当前责任人<br>详见 CONTEXT.md 和 docs/adr/ | - |

