# ADR 0006: DataWorks 实时同步专用账号 etl_sync(高权,owner 继承)

状态:已接受(2026-09-17)

## 背景

ADR 0005 开通了逻辑复制通道(etl_ro + 静态 publication etl_pub),前提是
**消费方复用我方预建的 etl_pub,只自建 slot**。DataWorks 实时同步上线时
该前提被证伪:它的作业固定**自建 publication**(`di_pub_*` 命名),不复用
既有对象。etl_ro 执行 `CREATE PUBLICATION di_pub_... FOR TABLE ...` 连续被
生产拒绝(日志:先 `permission denied for database insuredesk`,补上
数据库级 CREATE 后是 `must be owner of table`)。

卡点三层递进,前两层可补,第三层无解:

1. 建复制槽要 REPLICATION 属性(0005 已给 etl_ro);
2. `CREATE PUBLICATION` 要数据库级 CREATE 权限(可 GRANT);
3. `CREATE PUBLICATION FOR TABLE` 要求执行者是**目标表的 owner**——
   PG 对 publication 无细粒度授权,只读角色永远过不去。

## 决策

- **新建独立账号 `etl_sync`**:`LOGIN REPLICATION`,并 `GRANT insuredesk TO
  etl_sync`——经角色成员关系继承应用 owner 身份,获得建 publication 所需的
  表 ownership(数据库级 CREATE 也随之继承,无需单独 GRANT)。DataWorks
  作业专用,不用于手工查询。
- **etl_ro 与 etl_pub 通道不动**:0005 的轮询/复制通道保留,两条通道并存。
- **手工 provisioning,不进 migration/bootstrap**:0005 的迁移只覆盖 etl_ro
  侧;etl_sync 属一次性运维动作,创建与轮换命令记录于 deployment.md。
- DataWorks 用内置 `pgoutput`,不依赖 `wal2json`。PG 16+ 非超级用户只能
  加载 `output_plugin_libraries` 列出的输出插件,wal2json 未放行——未来有
  第三方工具坚持 wal2json 时再评估放开。

## 接受的代价

- `etl_sync` 实际是**全库读写账号**(含 DDL,继承自 insuredesk)。0004 对
  etl_ro 精心排除的认证审计面(users/api_keys 等)对它全部开放。这是
  DataWorks 对自建 PG 的硬性要求(官方建议 superuser 或表 owner),PG 无
  更细粒度方案。
- 口令配置在 DataWorks 作业里,泄露影响面远大于 etl_ro:发现泄露按
  deployment.md 急停 + 立即 `ALTER ROLE etl_sync PASSWORD` 轮换。
- DataWorks 自建 `di_pub_*` publication 与 `di_slot_*` slot,属正常行为,
  勿当异常清理;作业废弃后需手工删槽(见 deployment.md 巡检)。

## 后果

- 安全组需额外放行 DataWorks 独享资源组出口 IP(与 ETL 网段是两批源)。
- 磁盘保护沿用 0005 的 `max_slot_wal_keep_size=10GB`:DataWorks 断开超限
  后 slot 强制失效,恢复需重建 slot + 重做快照。
- 已验证(2026-09-17 生产):etl_sync 可建/删 publication 与 pgoutput slot,
  DataWorks 作业已成功创建 `di_pub_47586_cn_shenzhen` 与对应 slot。
