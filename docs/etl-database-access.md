# 数据湖直连数据库接入文档(ETL 消费方手册)

## 1. 这套系统是什么

InsureDesk 是保险行业客服工单系统:统一受理多渠道客户投诉/咨询/退费请求,
按 SLA 策略驱动时效,跟踪工单全生命周期。数据载体是一台单机部署的
PostgreSQL 17(docker 容器),与应用 API 同机。

**你们要接的就是这台生产库。** 它同时承载在线业务(客服刷列表、看板),
你们的查询与生产流量共享同一颗 CPU、同一块盘——这不是仓库副本,是线上心脏。

## 2. 连接信息

| 项 | 值 |
|---|---|
| 主机 | 服务器内网 IP|
| 端口 | `5432` |
| 用户 | `etl_ro` |
| 口令 | 由系统侧通过 `.env` 下发 |
| 库名 | `insuredesk` |
| 认证 | scram-sha-256(密码认证,无 SSL——链路限定内网) |
| 网络 | 云安全组只放行 ETL 出口网段;安全组是唯一访问控制层 |

两种消费方式,都已开通:

1. **SQL 直连轮询**(普通连接,SELECT 白名单表)。
2. **逻辑复制**(replication 连接,订阅变更流,见第 4 节)。

(DataWorks 实时同步走独立账号 `etl_sync`,不适用上两条,见第 9 节。)

psql 自检:

```bash
psql "host=<内网IP> port=5432 user=etl_ro dbname=insuredesk" -c "SELECT count(*) FROM tickets"
```

## 3. 你能看到什么、看不到什么

`etl_ro` 是只读角色(SELECT only,INSERT/UPDATE/DELETE/DDL 一律拒绝),
白名单 12 张表:

| 表 | 内容 |
|---|---|
| `tickets` | 工单主表(状态、SLA 盖章、分配、软删除) |
| `ticket_complaint_details` | 投诉类工单专属字段(客户姓名/电话/保单号等) |
| `ticket_refund_details` | 退费异常工单专属字段(投保人/金额/期次明细) |
| `process_logs` | 处理记录(工单操作审计时间线) |
| `ticket_import_batches` | Excel 批量导入批次 |
| `sla_policies` | 时效策略目录 |
| `ticket_kinds` | 工单种类目录 |
| `ticket_categories` / `channels` / `completion_statuses` / `user_feedback_channels` / `feedback_receive_channels` | 五个字典目录表 |

**看不到**:`users`、`roles`、`sessions`、`api_keys`、`api_access_logs`、
`api_key_audit_logs`(认证与审计面,含口令哈希,永不开)、`app_notifications`、
`callback_deliveries`、`shift_types`、`schedules`。对这些表任何 SELECT 都会
收到 `permission denied`,这是设计行为,不是故障。

⚠️ **未来新建的表会自动对你们开放 SELECT**(default privileges)。反之,
如果你们某天发现一张新表不可读,说明它被显式 REVOKE 了——有意为之,勿报障。

## 4. 逻辑复制(变更流)

`etl_ro` 带 REPLICATION 属性,可订阅 publication `etl_pub`(白名单同
第 3 节的 12 张表)。连接方式:

- 连接串加 `replication=database`,插件用 `pgoutput`。
- 复制 slot 由你们创建并命名;slot 会钉住 WAL,消费断开期间 WAL 持续堆积,
  超过 10GB 后 slot 被强制失效——届时需重建 slot 并重做快照,**断了就尽快
  恢复,别挂着**。
- 复制流内容与 SELECT 白名单一致:白名单外的表在流里不存在。
- 新建表默认不进 `etl_pub`(刻意设计,防敏感表随 default privileges
  自动外泄)。你们发现新表不在流里 = 系统侧未加,找系统侧确认后再加,
  勿自行绕过。

## 5. 读懂数据前必须知道的语义坑

以下每一条都是踩过才值钱的坑,抽数口径错一条,湖里的数就是错的:

1. **时区**:一切 `timestamptz` 以 UTC 存储(会话时区被强制为 UTC)。
   展示层才转 Asia/Shanghai,请自行 `AT TIME ZONE`。
2. **软删除**:`tickets.deletedAt` 非空 = 已删除。默认统计与列表都排除,
   你们也要按 `deletedAt IS NULL` 过滤,或把它当 tombstone 处理。
3. **工单状态只有 4 个存储值**:`unassigned / assigned / processing / completed`。
   页面上的「即将超时」「已超时」是**读时计算态**,不落库:按 `dueAt` 与当前
   时间自行重算(过 `dueAt` → overdue;距 `dueAt` 不足 2 小时 → 即将超时)。
   `pending_timeout`/`overdue` 跃迁**不会**更新 `updatedAt`,按增量抽数抽不到
   这类「变化」,需要展示态要自己算。
4. **增量抽数的游标**:`tickets(updatedAt, id)` 上有索引。建议
   `WHERE (updatedAt, id) > (上次游标) ORDER BY updatedAt, id` 翻页,并把
   `updatedAt` 往回拨几分钟做重叠窗口(并发事务可见序与 updatedAt 可能不一致,
   不回拨会漏行),按 id 幂等去重。
5. **字典是引用不是快照**:工单存目录 id,JOIN 字典表拿到的是**当前名**。
   管理员改目录名,历史工单显示的名也跟着变——这是产品语义,不是数据异常。
   `process_logs` 的 from/to 文本则是操作当时的字面快照。
6. **金额是字符串**:`ticket_refund_details` 的 `expectedAmount` /
   `compensationAmount` 等金额列是 `text`,原样存平台推送值。要做数值运算
   请显式 cast,注意空串与非法值防御。
7. **`process_logs.internalOnly = true` 是内部跟进记录**。数据若再转交给
   系统外部使用方,必须过滤这些行——泄漏内部备注是事故。
8. **`id` 是不透明主键,`workOrderNumber`(WO 开头)才是人类可读单号**。
   对运营展示用后者;JOIN 用前者。
9. **退费单 SLA 计时锚是平台推送的 `refundCreateTime`**(可早于工单创建 12h),
   存于 `tickets.slaAnchorAt`。算 SLA 一律以 `slaAnchorAt` 起算,别用 `createdAt`。
10. **多值保单号**:`ticket_complaint_details.policyNumbers` 是 `text[]`;
    `ticket_refund_details.refundTrades` 是 `jsonb` 期次明细原文。

## 6. 对生产库的礼貌(重要)

当前没有角色级 statement_timeout 和连接数上限——**你们的失控查询没有刹车**。
请自律:

- 并发连接 ≤ 2;全量刷新放夜间低峰,避开 21:30 的每日 pg_dump 备份窗口
  (备份与全量抽数叠加 = 双倍 IO 打在同一台机器上)。
- 单条 SQL 超 5 分钟就该重写(加分页/收窄时间窗),不要硬跑。
- 不要开长事务挂着抽数:长事务会顶住 vacuum,让在线库表膨胀。
- 禁止 `SELECT *` 无 WHERE 的全表裸拉做日常增量——首全量除外,且请提前打招呼。

## 7. schema 会变,而且没有兼容承诺

应用用 Prisma migrate 演进表结构,**每次发版都可能改表**。你们直连的是
物理 schema,等于把它当契约——但它不是契约:

- 列可能改名、拆表、下沉侧表(投诉字段下沉 `ticket_complaint_details`
  就是先例)。
- 发版不逐个通知下游。**建议**:抽取作业对「列缺失」显式报错而非静默置空,
  挂了立刻找系统侧核对 schema 变更。
- 新表自动可读(见第 3 节),但**不进复制流**(见第 4 节),新列出现在
  既有表不保证顺序。

## 8. 运维协同

| 事项 | 路径 |
|---|---|
| 口令轮换 | 系统侧改 `.env` + recreate,新口令下发;旧口令立即失效 |
| 你们搞挂了连接(口令错太多次等) | 无自动锁定机制,直接联系系统侧排查 |
| 系统侧急停 | 删 compose `ports:` + `up -d`,30 秒内 5432 关闭——发现异常连接/泄露时会先斩后奏 |
| 连接审计 | **没有**(未开 `log_connections`)。你们的连接行为不可追溯,同时也是信任前提 |

## 9. DataWorks 实时同步账号 etl_sync

DataWorks 实时同步作业不用 etl_ro,用专用账号 `etl_sync`(连接主机/端口/
库名/认证方式与第 2 节相同,口令单独下发)。与 etl_ro 的三点本质区别:

1. **它是可写账号**。DataWorks 建 publication 要求表的 ownership,etl_sync
   通过继承应用 owner 角色拿到该权限,实际权限 = 全库读写含 DDL。只许挂在
   DataWorks 同步作业上——禁止拿它跑手工 SQL、接 BI、配进任何带写动作的
   工具,误操作改的是线上数据,按事故处理。
2. **它看到的表没有白名单**。etl_ro 看不到的认证审计表(users、api_keys
   等)对 etl_sync 全部可见。同步任务选表自行限定在工单域(第 3 节清单),
   不要把认证审计面同步进湖。
3. **publication 与 slot 由 DataWorks 自建自管**(库里的 `di_pub_*` /
   `di_slot_*` 是它的对象,属正常)。作业停止期间 WAL 积压超 10GB 后 slot
   被强制失效,恢复 = 重建 slot + 重做快照,代价在贵方——作业要长期暂停
   或下线,提前打招呼,由系统侧确认对象清理。

第 5 节的语义坑(时区、软删除 tombstone、读时计算态、金额字符串等)对
同步流同样适用,逐条照做。
