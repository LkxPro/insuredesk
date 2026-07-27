# 外部渠道工单录入

## Problem Statement

当前工单录入依赖微信群人工收集：外部协作方（外包客服、合作伙伴）在各自微信群报工单，内部客服手工复制到系统。处理完成后，结果回复到群里。这导致：

- 信息分散：工单数据在微信与系统两处，状态不同步
- 录入重复：内部客服需要逐条搬运微信群消息
- 追问退回群里：原文信息不全时，内部客服仍需回微信群追问外部方
- 外部方无可见性：只能在群里催进度，无法自助查询

外部方无法直接在系统里提交与跟进工单，也看不到实时状态。

## Solution

新增**外部机构**实体与**外部用户角色**，允许外部协作方直接在系统内：

1. **提交工单**：粘贴客户反馈原文（`submissionText`），系统自动记录机构与渠道
2. **查看进度**：实时看到自己机构提交的所有工单状态、部分跟进记录和完结结果
3. **双向留言**：补充信息或回答内部客服追问，留言触发通知给责任人
4. **字段可见性管控**：管理员按机构配置可见字段白名单，隐藏敏感信息（客户电话/保单号等）

内部客服收到外部提交时获得通知，识别原文后补充业务字段（渠道/类别/客户信息等），按现有流程分配、处理、完结。外部方始终能看到最新状态与对外公开的跟进记录。

## User Stories

1. 作为外部协作方，我想直接在系统里提交工单原文，这样我不需要在微信群发消息等内部客服搬运
2. 作为外部协作方，我想看到我机构提交的所有工单状态，这样我能自助查进度而不用催
3. 作为外部协作方，我想在工单里留言补充信息，这样内部客服追问时我能直接回复
4. 作为外部协作方，我想看到内部客服的跟进记录，这样我知道工单处理到哪一步了
5. 作为外部协作方，我想看到工单完结状态与结果，这样我能把答复转给客户
6. 作为外部协作方同机构的同事，我想看到同事提交的工单，这样同事请假时我能接手
7. 作为内部客服主管，我想在外部方提交工单时收到通知，这样新单不会静默积压
8. 作为内部客服坐席，我想看到外部提交的原文，这样我能识别并补充业务字段
9. 作为内部客服坐席，我想在外部方留言时收到通知，这样我能及时回应追问
10. 作为内部客服坐席，我想标记某些跟进记录为"仅内部可见"，这样敏感判断不会泄露给外部方
11. 作为管理员，我想为每个外部机构配置可见字段白名单，这样敏感信息不会泄露给外部方
12. 作为管理员，我想为外部机构配置关联渠道，这样外部提交的工单自动带上渠道分类
13. 作为管理员，我想手工开设外部账号并指定所属机构，这样我能控制谁能进系统
14. 作为管理员，我想停用外部机构，这样该机构的账号无法继续提交或查看工单
15. 作为系统，我想把外部提交原文与内部客服整理后的客户诉求分开存储，这样原始信息永久留档可追溯
16. 作为系统，我想区分外部留言与内部跟进，这样外部留言不会污染首响时刻与跟进次数统计
17. 作为系统，我想按机构而非个人界定外部可见范围，这样同机构多人能协作查看同一批工单

## Implementation Decisions

### Schema Changes

**新增表 `ExternalOrg`（外部机构）**：
- `id`（主键）
- `name`（唯一，机构名称）
- `channelId`（可空，外键 → `channels.id`，`onDelete: SetNull`）：关联反馈渠道，外部提交时自动写入工单的 `channelId`
- `visibleTicketFields`（可空 String，JSON 编码字符串数组）：字段可见性白名单；`null` = 使用系统默认白名单
- `active`（布尔，默认 `true`）：停用后该机构账号无法提交或查看
- `createdAt` / `updatedAt`（时间戳）

**`User` 表新增字段**：
- `externalOrgId`（可空，外键 → `external_orgs.id`，`onDelete: Restrict`）：非空 = 外部用户

**`Ticket` 表新增字段**：
- `submissionText`（可空 String，≤2000）：外部提交原文，`source=external_channel` 时必填，创建后不可编辑
- `externalOrgId`（可空，外键 → `external_orgs.id`，`onDelete: SetNull`）：创建时写入的机构快照，不随机构改名/改渠道回写

**`ProcessLog` 表新增字段**：
- `internalOnly`（布尔，默认 `false`）：`true` = 仅内部可见，外部查询时过滤掉

**枚举扩展**：
- `TICKET_SOURCES` 新增 `"external_channel"`
- `CREATOR_BACKED_SOURCES` 新增 `"external_channel"`（外部工单记录 `creatorId`）
- `PROCESS_LOG_ACTIONS` 新增 `"external_note"`（外部留言）
- `TICKET_SOURCE_LABELS` 新增 `external_channel: "外部渠道"`
- `PROCESS_LOG_ACTION_LABELS` 新增 `external_note: "外部留言"`

**权限点**：
- `ticket.create_external`：创建外部工单（外部角色持有）
- `ticket.process_external`：发外部留言（外部角色持有）
- `external_org.manage`：管理外部机构（含 CRUD + 字段可见性配置，管理员持有）

**种子数据**：
- 新增"外部用户"角色，持有 `ticket.create_external` + `ticket.process_external`，不持有 `ticket.view` / `ticket.view_all`

**约束**：
- `Ticket.source = "external_channel"` 时，`submissionText`、`externalOrgId`、`creatorId` 三者必须非空（service 层校验）
- `User.externalOrgId != null` 时，其 `roleId` 必须指向持有外部权限点的角色（service 层校验）
- `ExternalOrg` 被 `User` 或 `Ticket` 引用时，只能停用（`active = false`），不能物理删除（Prisma `onDelete: Restrict` 阻止删除）

### API Contracts

**外部工单 router（新增 `externalTicketRouter`）**：

- `submit`（mutation）：
  - 守卫：`ticket.create_external`
  - 输入：`{ submissionText: string }`（必填，≤2000）
  - 行为：创建工单，`source=external_channel`，`creatorId=当前用户`，`externalOrgId=当前用户机构`，`channelId=机构的 channelId`（可空），`status=unassigned`，其他业务字段全部 `null`/`[]`
  - 副作用：写入一条 `action=create` ProcessLog；群发 `external_submitted` 通知给所有持有 `ticket.assign` 的启用用户
  - 返回：`{ id, workOrderNumber }`

- `list`（query）：
  - 守卫：`ticket.create_external`（外部角色持有，复用作为页面守卫）
  - 输入：`{ status?: TicketStatus[], search?: string, offset, limit }`
  - 数据范围：`externalOrgId = 当前用户机构 AND deletedAt IS NULL`
  - 字段裁剪：返回前按当前用户机构的 `visibleTicketFields` 白名单裁剪（白名单外字段设为 `null`/`[]`/`undefined`）
  - 排序：`createdAt DESC`
  - 返回：`{ items: Ticket[], total }`

- `detail`（query）：
  - 守卫：`ticket.create_external`
  - 输入：`{ ticketId: string }`
  - 数据范围：`externalOrgId = 当前用户机构 AND deletedAt IS NULL`，否则 404
  - 字段裁剪：按白名单裁剪
  - ProcessLog 过滤：仅返回 `action IN ('comment', 'external_note', 'resolve') AND (action != 'comment' OR internalOnly = false)`
  - 返回：裁剪后的工单详情 + 过滤后的 ProcessLog 数组

- `addNote`（mutation）：
  - 守卫：`ticket.process_external`
  - 输入：`{ ticketId: string, content: string }`（≤2000）
  - 前置条件：工单 `status != 'completed'` 且 `externalOrgId = 当前用户机构`
  - 行为：写入 `action=external_note` ProcessLog（`operatorId=当前用户`，`remark=content`），不修改工单的 `contactCount`/`processingResult`/首响字段
  - 副作用：触发轨 1 通知给当前 `assigneeId`（若未分配则群发给持 `ticket.assign` 者）
  - 返回：`{ success: true }`

**外部机构 router（新增 `externalOrgRouter`）**：

- `list`（query）：
  - 守卫：`external_org.manage`
  - 返回：`{ id, name, channelId, channelName, visibleFieldCount, userCount, active }[]`

- `create`（mutation）：
  - 守卫：`external_org.manage`
  - 输入：`{ name: string, channelId?: string, visibleTicketFields?: string[] }`
  - 校验：`name` 唯一；`visibleTicketFields` 每项必须属于 `EXTERNAL_VISIBLE_FIELD_OPTIONS`，不得包含 `SENSITIVE_TICKET_FIELDS`
  - 行为：创建机构，`active=true`
  - 返回：`{ id }`

- `update`（mutation）：
  - 守卫：`external_org.manage`
  - 输入：`{ id: string, name?: string, channelId?: string, visibleTicketFields?: string[] }`
  - 校验同 `create`
  - 返回：`{ success: true }`

- `setActive`（mutation）：
  - 守卫：`external_org.manage`
  - 输入：`{ id: string, active: boolean }`
  - 行为：设置 `active` 状态
  - 返回：`{ success: true }`

**用户 router 改动**：
- `create` / `update` 输入 schema 新增 `externalOrgId?: string`
- service 层校验：外部角色用户必须有 `externalOrgId`，内部角色用户不能有

**通知模块改动**：
- 新增 `buildExternalSubmittedNotification`：标题"外部工单提交"，内容"{机构名} 提交了新工单 {工单号}"
- 新增 `buildExternalNoteNotification`：标题"外部留言"，内容"{用户名} 在工单 {工单号} 添加了留言"
- 群发逻辑：查询所有持有指定权限点的启用用户，批量写入 AppNotification

**数据范围模块改动**：
- 新增 `applyExternalOrgDataScope(user)`：返回 `{ externalOrgId: user.externalOrgId }`（外部用户）或 `{}`（内部用户）
- 外部 ticket router 的所有查询都通过此函数应用数据范围

**字段可见性模块（新增 `ticket-field-visibility.ts`）**：
- `EXTERNAL_VISIBLE_FIELD_OPTIONS`：外部可配置的字段候选清单（从 `TICKET_FIELDS` 派生，排除 `SENSITIVE_TICKET_FIELDS`）
- `SENSITIVE_TICKET_FIELDS`：明确禁止外部可见的字段数组（`phone`, `contactPhone`, `policyNumbers`, `internalOrderNumber`, `customerName`, `contactId`）
- `DEFAULT_EXTERNAL_VISIBLE_FIELDS`：未配置机构的默认白名单（`workOrderNumber`, `feedbackTime`, `status`, `completionStatusId`, `processingResult`）
- `filterVisibleFields(ticket, whitelist)`：按白名单裁剪工单对象，返回新对象

**内部工单 router 改动**：
- `addComment` 输入 schema 新增 `internalOnly?: boolean`（默认 `false`）
- service 层写入 ProcessLog 时携带 `internalOnly` 字段

### UI Changes

**外部用户页面（新增 `apps/web/src/pages/external-tickets/`）**：

- `ExternalTicketListPage.tsx`：
  - 路由：`/external-tickets`
  - 守卫：`ticket.create_external`
  - 功能：列表展示本机构工单，筛选（status + 搜索框），右上角"+ 提交工单"按钮
  - 列：按当前用户机构的 `visibleTicketFields` 动态渲染
  - 排序：`createdAt DESC`

- `ExternalTicketDetailPage.tsx`：
  - 路由：`/external-tickets/:id`
  - 守卫：`ticket.create_external`
  - 功能：字段卡片（按 `TICKET_FIELDS` 顺序，仅渲染白名单内且非空的字段） + 时间线（过滤后的 ProcessLog） + 底部留言框（未完结时）
  - 时间线显示：`comment`（非 internal）、`external_note`、`resolve`

- `ExternalTicketSubmitDialog.tsx`：
  - 表单：一个多行文本框 `submissionText`（必填，≤2000）
  - 提交后跳转到列表页

**外部机构管理页（新增 `apps/web/src/pages/external-orgs/`）**：

- `ExternalOrgManagePage.tsx`：
  - 路由：`/external-orgs`（放在「用户管理」导航分组下）
  - 守卫：`external_org.manage`
  - 表格列：名称、关联渠道、可见字段数、账号数、状态
  - 行操作：编辑、停用/启用
  - 新建按钮：打开编辑弹窗

- `ExternalOrgEditDialog.tsx`：
  - 表单：名称（必填）、关联渠道（下拉，可空）、可见字段（多选框组，候选 = `EXTERNAL_VISIBLE_FIELD_OPTIONS`）
  - 实时显示已选字段数

**用户管理页改动**：
- 用户新建/编辑弹窗新增"外部机构"选择器（仅当角色持有外部权限点时出现）

**内部工单详情页改动**：
- `AddCommentCard.tsx` 新增勾选框"仅内部可见"（默认不勾）

**导航菜单改动**：
- 外部用户（`externalOrgId != null`）：隐藏"工单管理"，显示"我的工单"
- 持有 `external_org.manage` 的用户：显示"外部机构管理"

### Migration Strategy

**一次迁移**（`apps/api/prisma/migrations/xxx_external_channel_submission`）：

1. `CREATE TABLE external_orgs`（id, name, channelId FK, visibleTicketFields, active, createdAt, updatedAt）
2. `ALTER TABLE users ADD COLUMN externalOrgId TEXT REFERENCES external_orgs(id) ON DELETE RESTRICT`
3. `ALTER TABLE tickets ADD COLUMN submissionText TEXT`（≤2000）
4. `ALTER TABLE tickets ADD COLUMN externalOrgId TEXT REFERENCES external_orgs(id) ON DELETE SET NULL`
5. `ALTER TABLE process_logs ADD COLUMN internalOnly BOOLEAN NOT NULL DEFAULT false`
6. 种子：插入"外部用户"角色（权限 = `["ticket.create_external", "ticket.process_external"]`）

**回滚路径**：
- 删除外键约束
- 删除新增列
- 删除 `external_orgs` 表
- 删除"外部用户"角色

## Testing Decisions

**测试原则**：
- 只测试外部行为（API 契约、数据范围、字段可见性），不测实现细节
- 通过 `appRouter.createCaller` 测试（对齐现有 `apps/api/test/ticket.integration.test.ts` 模式）
- 使用 testcontainers + 真实 Postgres，覆盖数据范围、通知写入、ProcessLog 过滤

**测试覆盖**（新增 `apps/api/test/external-ticket.integration.test.ts`）：

1. **外部提交**：
   - 成功提交：`submissionText` 写入，`source=external_channel`，`externalOrgId`/`creatorId` 正确，机构 `channelId` 自动带入工单
   - 校验失败：`submissionText` 缺失/超长拒绝
   - 通知触发：持 `ticket.assign` 的用户收到 `external_submitted` 通知
   - ProcessLog 写入：`action=create`

2. **外部列表**：
   - 数据范围：仅看到本机构工单，看不到其他机构或内部手工录入的
   - 字段裁剪：白名单外字段返回 `null`
   - 软删除排除：`deletedAt != null` 的工单不出现

3. **外部详情**：
   - 数据范围：查询他机构工单返回 404
   - ProcessLog 过滤：仅返回 `comment`（非 internal）+ `external_note` + `resolve`，隐藏 `assign`/`status_change`/`edit`
   - 字段裁剪：白名单外字段不返回

4. **外部留言**：
   - 成功留言：`action=external_note`，不修改 `contactCount`/`processingResult`
   - 通知触发：当前责任人收到通知（未分配时群发给持 `ticket.assign` 者）
   - 前置条件：已完结工单拒绝留言

5. **内部跟进 `internalOnly` flag**：
   - 内部坐席添加 `internalOnly=true` 的 comment
   - 外部详情查询时该 comment 被过滤

6. **机构管理**：
   - CRUD：创建、更新、停用机构
   - 字段可见性校验：敏感字段（`phone`/`policyNumbers` 等）被拒绝
   - 非法字段名拒绝
   - 停用机构后外部用户无法提交（前置条件校验）

7. **用户开号校验**：
   - 外部角色用户缺 `externalOrgId` 时拒绝创建
   - 内部角色用户带 `externalOrgId` 时拒绝创建

**测试模块**：
- `apps/api/test/external-ticket.integration.test.ts`（主测试文件）
- `apps/api/test/external-org.integration.test.ts`（机构管理）
- 复用现有 `integration-harness.ts` 的 seed 机制，新增 `externalOrgs` seed 集

**先验艺术**（参考现有测试）：
- `apps/api/test/ticket.integration.test.ts`：工单创建、详情、数据范围
- `apps/api/test/notification.integration.test.ts`：通知写入与查询
- `apps/api/test/ticket-comment.integration.test.ts`：跟进记录
- `apps/api/test/user.integration.test.ts`：用户 CRUD

## Out of Scope

本期明确不做：

1. **字段脱敏显示**（如 `138****5678`）：本期只支持完全隐藏
2. **外部方上传附件**：截图需求真实存在，但附件涉及存储、体积、类型白名单和内容风险，单独一期处理。本期外部方要传图还是回群里发
3. **按角色配置可见性模板**：本期仅支持按机构配置，逐一配置成本可接受（外部机构数量级为十家）
4. **提交即自动分配**：字段补全责任在坐席，但推力机制是群发通知 + 主管手动分配，不走自动分配
5. **独立"待识别"状态**：外部提交后直接 `unassigned`，由通知驱动处理，不改状态机
6. **外部方看到内部操作记录**（`assign`/`status_change`/`edit`）：完全隐藏
7. **首次登录强制改密**：这是全系统能力（内部账号同样受益），不作为本功能附属品，单独立 issue
8. **外部方修改 `submissionText`**：原文创建后不可编辑（含外部方自己），留档价值高于修正拼写错误

## Further Notes

**系统默认可见字段白名单**（机构 `visibleTicketFields = null` 时使用）：
- `workOrderNumber`（工单号）
- `feedbackTime`（反馈时间）
- `status`（状态）
- `completionStatusId`（完结状态）
- `processingResult`（最新跟进）

**敏感字段清单**（明确禁止外部可见）：
- `phone`（客户电话）
- `contactPhone`（联系人电话）
- `policyNumbers`（保单号）
- `internalOrderNumber`（内部订单号）
- `customerName`（客户姓名）
- `contactId`（进线 ID）

**字段展示顺序**：
- 列表列：按 `visibleTicketFields` 顺序渲染
- 详情页：按 `TICKET_FIELDS` 声明顺序渲染（不是按 `visibleTicketFields` 顺序），管理员配可见字段时不用关心顺序

**与微信群的关系**：
- 本期目标：替代"录入动作"与"查进度"，保留"追问"能力（通过外部留言）
- 预期：群消息量下降，但群不会立即关闭（外部方需要适应期）
- 成功指标：外部方主动查系统而非催群

**后续优化方向**：
1. 字段脱敏显示（部分可见）
2. 外部方上传附件
3. 按角色配置可见性模板
4. 外部方专属仪表盘（统计自己机构的工单数据）
5. 外部 API（webhook 推送状态变更，供外部方系统集成）
