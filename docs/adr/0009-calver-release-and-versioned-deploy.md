# ADR 0009: CalVer 发版与钉版本部署

**状态**:已接受(修订 ADR 0007 的"git pull + 本地构建"更新流程)

项目从活跃开发转入生产阶段,引入正式发版。决策如下:

## 版本与产物

- **版本号用 CalVer**:`v2026.07.0`,同月再次发布递增末位。不采用 semver——
  内部业务系统无外部消费者,"算不算 breaking"的纠结不产生价值。git tag 是
  唯一版本事实,`package.json` 各包版本保持 `0.0.0` 不随发版变动。
- **一个 release = tag + GitHub Release + 生产镜像**:`workflow_dispatch`
  一键触发发版 workflow——自动算出下一个 CalVer 号、打 tag、创建 GitHub
  Release(notes 由 GitHub 按 PR 自动生成,`.github/release.yml` 按 label
  分组),并构建 api 生产镜像推送 `ghcr.io/lkxpro/insuredesk-api:<tag>`。
  仓库私有,镜像同为私有,服务器拉取前需用 PAT `docker login ghcr.io`。

## 部署与回滚

- **钉版本部署**:`docker-compose.prod.yml` 的 api 服务改为
  `image: ghcr.io/lkxpro/insuredesk-api:${IMAGE_TAG}`,版本号钉在服务器
  `.env`;保留 `build:` 段作退路——受限网络拉不动 GHCR 时 checkout 同名
  tag 本地构建,两条路径产物同源。升级 = 改 `IMAGE_TAG` 后 `up -d`。
- **只前滚**:镜像回滚(改回上一个 `IMAGE_TAG`)仅适用于新版起不来、迁移
  未执行的场景;迁移已执行后发现问题一律发 hotfix 版本前滚。不维护 down
  迁移——单机小团队下其编写、测试成本高而真出事时从未演练、不敢执行。
  灾难性故障靠数据库备份恢复兜底,升级前固定手动 dump 一次。

## 备份

宿主机 cron 每日 `pg_dump` 存本机,保留若干天。**已知风险**:无异地副本,
机器级故障(磁盘损坏、入侵、机房事故)= 数据全失;接受此风险,异地同步
留作后续升级项。

## 仓库治理

CI 增加生产 Dockerfile 构建校验(只构建不推送),避免镜像坏到发版才发现;
启用 Dependabot 自动依赖升级 PR。

## 明确不做(后续可选)

监控告警(健康检查/拨测/错误上报)、异地备份、admin 初始密码强制修改、
main 分支保护(禁直推)——均记为已知风险或后续项,不阻塞首次发版。

拒绝的方案:semver(breaking 语义对内部系统无意义)、永远部署 `latest`
(服务器上看不出在跑哪版、回滚要临时改文件)、本地打 tag 触发(版本号靠
人脑递增易错)、WAL 连续归档(对工单系统的丢数据容忍度而言过重)。

操作步骤见 `docs/releasing.md`,部署细节见 `docs/deployment.md`。
