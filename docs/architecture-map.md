# InsureDesk 系统全景图

数据模型 + 业务逻辑一张图。配套词汇定义见 [CONTEXT.md](../CONTEXT.md)。

## 总览大图

```mermaid
flowchart TB
    subgraph  actors["角色（Actor）"]
        CS["一线客服<br/>ticket.view/process"]
        SUP["客服主管<br/>分配·考核·看板"]
        ADM["管理员<br/>唯一系统角色<br/>恒拥全部正向权限点"]
        EXT["外部账号<br/>提交方（保司/经纪）<br/>凭证+6项预填"]
    end

    subgraph  web["前端 apps/web（页面）"]
        direction LR
        P_LOGIN["登录 Login"]
        P_TICK["工单列表/详情<br/>tickets + ticket-surface 深模块"]
        P_EXT["我的工单（外部）<br/>external-tickets"]
        P_DASH["看板 dashboard"]
        P_TODO["铃铛·收件箱+我的待办"]
        P_SCHED["排班 schedule"]
        P_CFG["系统配置<br/>字典/SLA/班次/角色/用户/外部账号"]
    end

    subgraph  api["API apps/api（tRPC routers）"]
        direction LR
        R_AUTH["auth"]
        R_TICK["ticket"]
        R_EXTT["external-ticket"]
        R_DASH["dashboard"]
        R_NOTI["notification"]
        R_SCHED["schedule / shift-type"]
        R_CFG["role / user / sla /<br/>channel / category /<br/>completion-status /<br/>external-account<br/>（三者共用 dictionary-catalog 目录工厂）"]
        R_FILE["routes: 导入/导出<br/>（xlsx 文件流）"]
        R_DEMO["demo（仅 RBAC 守卫<br/>测试探针，非业务）"]
    end

    subgraph  svc["服务层 services（业务逻辑）"]
        S_LIFE["生命周期<br/>create→assign→comment→resolve<br/>ticket-assign/comment/resolve/edit/delete"]
        S_SLA["SLA 时钟<br/>dueAt/预警/首响/跟进检查点<br/>sla + todo（读时计算）"]
        S_DUP["查重<br/>ticket-duplicate<br/>同客户+类别疑似重复"]
        S_IMP["批量导入/整批撤销<br/>ticket-import(+batch)"]
        S_EXP["导出 xlsx<br/>ticket-export / external-ticket-export"]
        S_SCOPE["数据范围 data-scope<br/>全部/个人(assignee+creator)"]
        S_NOTI["通知两轨<br/>轨1事件落库 / 轨2待办读时算"]
        S_DUTY["在岗判定<br/>排班+墙钟时段<br/>schedule"]
    end

    subgraph  db["PostgreSQL 13 张表"]
        direction TB
        T_TICK[("tickets 工单<br/>核心实体")]
        T_PLOG[("process_logs<br/>处理记录·时间线")]
        T_BATCH[("ticket_import_batches<br/>导入批次=撤销单位")]
        T_USER[("users 用户<br/>内外同表<br/>外部带6项预填")]
        T_ROLE[("roles 角色<br/>权限点数组")]
        T_SESS[("sessions 会话<br/>httpOnly cookie")]
        T_DICT[("channels 反馈渠道<br/>ticket_categories 客诉类别<br/>completion_statuses 完结状态<br/>字典目录三件套")]
        T_SLA[("sla_policies<br/>每投诉等级一行")]
        T_SHIFT[("shift_types 班次定义")]
        T_SCHED[("schedules 排班<br/>user×date 唯一")]
        T_NOTI[("app_notifications<br/>轨1收件箱")]
    end

    CS --> P_TICK
    SUP --> P_TICK & P_DASH & P_SCHED
    ADM --> P_CFG
    EXT --> P_EXT
    P_LOGIN --> R_AUTH
    ALL["全部页面"] -.-> P_TODO --> R_NOTI

    P_TICK --> R_TICK & R_FILE
    P_EXT --> R_EXTT
    P_DASH --> R_DASH
    P_SCHED --> R_SCHED
    P_CFG --> R_CFG

    R_TICK --> S_LIFE & S_DUP & S_SLA
    R_FILE --> S_IMP & S_EXP
    R_EXTT --> S_LIFE
    R_DASH --> S_SLA
    R_NOTI --> S_NOTI
    R_TICK & R_EXTT & R_DASH --> S_SCOPE
    R_SCHED --> S_DUTY

    S_LIFE --> T_TICK & T_PLOG & T_NOTI
    S_IMP --> T_BATCH & T_TICK
    S_SLA --> T_SLA & T_TICK
    S_SCOPE --> T_TICK & T_USER
    S_NOTI --> T_NOTI
    S_DUTY --> T_SCHED & T_SHIFT
    R_AUTH --> T_USER & T_SESS
    R_CFG --> T_ROLE & T_DICT & T_SLA & T_USER
    T_TICK -.引用.-> T_DICT
    T_TICK -.责任人/创建人.-> T_USER
    T_USER -.角色.-> T_ROLE
```

## 数据模型（ER）

```mermaid
erDiagram
    roles ||--o{ users : "roleId"
    users ||--o{ sessions : "userId"
    users ||--o{ tickets : "assigneeId 责任人"
    users ||--o{ tickets : "creatorId 创建人/外部提交者"
    users ||--o{ schedules : "userId"
    users ||--o{ app_notifications : "targetUserId"
    users ||--o{ ticket_import_batches : "importerId"
    users }o--o| channels : "prefillChannelId 预填渠道"

    tickets ||--o{ process_logs : "ticketId 级联删"
    tickets }o--o| channels : "channelId Restrict"
    tickets }o--o| ticket_categories : "categoryId Restrict"
    tickets }o--o| completion_statuses : "completionStatusId Restrict"
    tickets }o--o| ticket_import_batches : "importBatchId Restrict"
    shift_types ||--o{ schedules : "shiftId"

    tickets {
        string workOrderNumber "WO+全局序列"
        string source "录入方式 manual/feishu_form/community/external_channel/file_import"
        string status "仅4基础状态 unassigned/assigned/processing/completed"
        string complaintLevel "唯一SLA驱动 可空=未定级"
        string priority "自由标签 与SLA无关"
        datetime dueAt "createdAt+超时 分配不重算"
        datetime deletedAt "软删除"
        text submissionText "外部提交原文"
    }
    roles {
        string_array permissions "权限点 含限制类(勾选=禁止)"
        string_array requiredTicketFields "建单必填字段集"
        bool system "仅管理员 true"
    }
    users {
        string username "唯一登录名"
        string feishuUserId "预留飞书SSO"
        string prefillChannelId "外部预填1/6"
        string prefillProject "外部预填2/6 项目保司"
    }
    sla_policies {
        string complaintLevel "自然键 每级一行"
        int firstResponseMinutes "首响红线"
        int overdueHours "超时时长 null=特急无期限"
        json reminderRules "类型化提醒规则"
    }
    process_logs {
        string action "create/assign/status_change/comment/upload/resolve/edit"
        string operatorName "姓名快照 不随改名改写"
        bool internalOnly "true=外部不可见"
    }
    app_notifications {
        string type "assigned/external_*/external_reply/external_resolved"
        bool read "未读角标"
    }
    schedules {
        string date "墙钟日期 user+date 唯一"
        string remark "备注"
    }
```

## 工单生命周期与 SLA

```mermaid
stateDiagram-v2
    [*] --> unassigned: 创建（5种来源）
    unassigned --> assigned: assign 分配<br/>写轨1通知
    assigned --> processing: 首条comment跟进<br/>contactCount+1
    processing --> processing: comment 继续跟进
    assigned --> assigned: 改派（重算通知）
    processing --> assigned: 改派
    assigned --> completed: resolve<br/>必选完结状态
    processing --> completed: resolve
    completed --> [*]: 终态 不可重开<br/>SLA快照冻结

    unassigned --> unassigned: ⚠ SLA时钟照走<br/>倒逼尽快分配

    note right of unassigned
        计算状态（读时派生，不落库）：
        pending_timeout = 在途且过deadlineWarningAt
        overdue = 在途且过dueAt
    end note
    note right of completed
        超时口径两视角：
        看板=在途已过dueAt（完结移出）
        考核=曾超时即计入（含超时完结）
    end note
```

## 通知两轨制

```mermaid
flowchart LR
    subgraph 轨1["轨1 收件箱（落库 app_notifications）"]
        A1["分配/改派 → assigned<br/>→ 新责任人"]
        A2["外部提交 → external_submitted<br/>→ 广播/责任人"]
        A3["外部留言 → external_note"]
        A4["内部跟进(非internal) → external_reply<br/>内部完结 → external_resolved<br/>→ 直达外部提交者"]
    end
    subgraph 轨2["轨2 我的待办（不落库，读时计算）"]
        B1["待首响 过firstResponseMinutes"]
        B2["检查点未达 follow_up_checkpoint"]
        B3["特急欠跟进 rolling_follow_up"]
        B4["due_soon / overdue"]
        B5["前端30s轮询 按当前assigneeId算"]
    end
```

## 关键设计取舍速查

| 主题 | 取舍 |
|---|---|
| 枚举值 | 中文枚举值存 String，真相源在 `packages/shared/src/enums.ts`，Zod 在 API 边界执法 |
| 字典目录 | 工单存引用不存快照；改名全局生效；被引用行只能停用（DB 层 Restrict 兜底） |
| 状态 | 只存 4 个基础状态；pending_timeout/overdue 读时计算 |
| SLA | complaintLevel 唯一驱动；时钟自 createdAt 起算与分配无关；dueAt 分配/改派永不重算；完结冻结快照 |
| 历史 | ProcessLog/通知存姓名与工单号快照，operatorId 故意不设 FK——改名/离职不改写历史 |
| 权限 | 角色=权限点数组；数据范围仅全部/个人两档；限制类权限勾选=禁止；管理员恒拥全量正向权限 |
| 外部账号 | 全库恰好一个外部角色（按库中权限数组判定）；只看自己提交的工单；导出恒开无权限点；PII 全量展示（原文本可见） |
| 排班分配 | 在岗=启用+排班+墙钟在时段内；自动分配选手工单最少者，不按渠道路由；无合规在岗者记 no_on_duty 跳过 |
| 导入撤销 | 批次=撤销单位；干净批次（无处理无单删）可整批软删撤销，不可恢复 |
| 删除 | 工单软删除（deletedAt）；ProcessLog/附件保留；本期只删不恢复 |
| 会话 | Postgres 存 session，httpOnly cookie，闲置过期 |
