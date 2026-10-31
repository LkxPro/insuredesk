# ADR 0005: ETL 逻辑复制(wal_level=logical + etl_pub)

状态:已接受(2026-09-17)

## 背景

ADR 0004 给数据湖的接入是 SQL 直连轮询。ETL 消费方随后要求**逻辑复制**:
以 `etl_ro` 用 replication 协议订阅变更流,降低对生产库的轮询压力并获得
低延迟增量。0004 的直连轮询通道保留,两者并存。

## 决策

- **`wal_level=logical`**:`ALTER SYSTEM` 设置 + 重启 db 容器(秒级中断)。
  配套 `max_slot_wal_keep_size=10GB`:消费方长期断开时 WAL 堆积有上限,
  超限 slot 失效(需重建 slot + 重做快照)但保磁盘。
- **`etl_ro` 加 REPLICATION 属性**:REPLICATION 实质是集群级权限——可拉
  **全部库全部表**的 WAL 流、可执行 pg_basebackup 整库物理副本,绕过表级
  白名单。访问面仍由 pg_hba(仅 etl_ro 可建 replication 连接)+ 云安全组
  收口;消费侧逻辑订阅按 publication 取流。这是已知并接受的扩大。
- **静态表级 publication `etl_pub`**:白名单与 0004 的 SELECT 授权完全一致
  (12 张工单域表)。明确不用 `FOR ALL TABLES`——default privileges 会自动
  给新表开 SELECT,若 publication 也自动全收,复制流就绕过了白名单。
  代价:**新建表默认不进复制**,需 `ALTER PUBLICATION etl_pub ADD TABLE …`
  显式加入(同时把表加进 SELECT 白名单,若此前未在)。
- **pg_hba 追加** `host replication etl_ro all scram-sha-256`(与既有
  `host all all all` 同模式,源限制仍在安全组)。
- 复制 slot 由消费方创建(pgoutput),名称与消费节奏归 ETL 侧管理。

**例外(2026-09-17 补)**:DataWorks 实时同步不适用本通道——它的作业固定
自建 publication(`di_pub_*`),不复用 etl_pub,而 publication 的创建要求
表 ownership,etl_ro 给不了。DataWorks 改走高权账号 etl_sync,见 ADR 0006。

## 运维点(服务器侧一次性手工项)

以下不在 Prisma 迁移内,已在生产执行,重建环境时需重做:

1. `ALTER SYSTEM SET wal_level='logical'` 与
   `max_slot_wal_keep_size='10GB'`,重启 db 容器。
2. pg_hba 追加上述 replication 行。

迁移 `20260917000000_etl_logical_replication` 只负责角色属性与
publication(幂等)。

## 后果

- 磁盘风险缓解策略从「无」变为「slot 超限失效」:消费方断开超过
  10GB WAL 积压后必须重建 slot 并重做快照。
- publication 白名单与 SELECT 白名单是**两份清单**,加表时要同步两处;
  漂移表现为「能 SELECT 但复制流没有」或反之,不报错。
- `wal_level=logical` 对全部写入增加少量 WAL 体积,单实例负载可忽略。
