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

- **钉版本部署**:`docker-compose.prod.yml` 的 api 服务
  `image: ghcr.io/lkxpro/insuredesk-api:${IMAGE_TAG}`,版本号钉在服务器
  `.env`;保留 `build:` 段作退路——受限网络拉不动 GHCR 时 checkout 同名
  tag 本地构建,两条路径产物同源。
- **升级一条命令**:`make upgrade` 用 `git ls-remote --tags` 解析出最新
  CalVer(与发版 workflow 同一套排序口径),写回 `.env` 的 `IMAGE_TAG`,再
  `pull` + `up -d`;当前已是最新则直接退出。操作员不手敲版本号,但服务器
  上始终钉着确定的 tag——回滚有明确目标、stray `up -d` 不跳版本。升级前的
  数据库备份是脚本第一步(见「备份」),迁移随容器启动执行,故此备份天然
  早于迁移,无需在启动链里另设一道。
- **只前滚**:镜像回滚(改回上一个 `IMAGE_TAG`)仅适用于新版起不来、迁移
  未执行的场景;迁移已执行后发现问题一律发 hotfix 版本前滚。不维护 down
  迁移——单机小团队下其编写、测试成本高而真出事时从未演练、不敢执行。
  灾难性故障靠数据库备份恢复兜底。

## 备份

备份跑在容器内,不依赖宿主机 crontab——部署只需 `docker compose up`,备份
随之自带,不必每台机手工配 cron。

- **执行器**:一个 backup sidecar 服务,`image: postgres:17-alpine`(与 db
  同镜像:`pg_dump` 版本与服务器 Postgres 精确匹配、自带 crond,无需自建
  镜像或往 api 镜像塞 postgresql-client)。`restart: unless-stopped` 常驻,
  内置 crond 按 `TZ=Asia/Shanghai` 每晚 21:30 经 compose 网络
  `pg_dump -h insuredesk-db-prod` 一次;容器启动即先备份一次以自证可用。
- **落盘**:宿主机 bind mount `~/backups/insuredesk`,gzip,保留 14 天。选
  宿主机目录而非具名卷——`down -v` 删不到、`ls`/`scp` 直接可见、日后搬异地
  只是 `scp`;不落 repo 内(`git clean` 会删、且进 `build:` 上下文)。
- **升级前备份**:`make upgrade` 第一步 `docker compose run --rm backup once`
  复用同镜像同脚本 dump 一次,与每日备份同一份逻辑、两个入口。
- **可见性(仅被动)**:sidecar 带 compose healthcheck,断言 25h 内产出过
  新备份文件(日备周期 + 1h 余量,不在 21:30 边界抖动),否则
  `docker compose ps` 显示 `unhealthy`。不做主动告警——见下「已知风险」。

## 已知风险(均为主动接受,非缺陷)

- **无异地副本**:备份与正库同机同盘,机器级故障(磁盘损坏、入侵、机房
  事故)= 数据全失。异地同步留作后续升级项。
- **无主动告警**:sidecar 静默停止(OOM/crash)不会主动通知,只在登服务器
  查看 `docker compose ps` 时经 healthcheck 可见。主动告警(邮件/webhook/
  dead-man's-switch)要么引入外部 SaaS、要么自建器与正库同生共死,均与
  「备份不依赖外部系统」冲突,不做。
- **「文件在」≠「可恢复」**:healthcheck 只验证备份文件存在且新鲜,不验证
  能否灌回(大版本格式漂移、编码/扩展缺失等)。唯一凭据是定期恢复演练,
  属运维流程(`docs/deployment.md` 每季度恢复演练 checklist),不做成功能。
- **绕过升级脚本**:手改 `.env` 的 `IMAGE_TAG` 后直接 `up -d` 会让迁移在
  无备份下执行。`make upgrade` 是唯一 sanctioned 升级路径,手动操作自负。

## 仓库治理

CI 增加生产 Dockerfile 构建校验(只构建不推送),避免镜像坏到发版才发现;
启用 Dependabot 自动依赖升级 PR。

## 明确不做(后续可选)

主动监控告警(拨测/错误上报/备份失败推送)、异地备份、admin 初始密码强制
修改、main 分支保护(禁直推)——均记为已知风险或后续项,不阻塞发版。备份的
被动 healthcheck 已做(见「备份」),此处指的是会主动够到人的告警。

拒绝的方案:semver(breaking 语义对内部系统无意义)、compose 直接跑
`latest`(可变标签使迁移可从非升级路径溜进容器、回滚仍需翻出具体 tag;
版本号已烤进镜像并在日志/页脚自报,故沿用钉版本而非 latest)、本地打 tag
触发(版本号靠人脑递增易错)、WAL 连续归档(对工单系统的丢数据容忍度而言
过重)、宿主机 crontab 跑备份(需每台机手工配、易漏,改为容器内 sidecar 自带)。

操作步骤见 `docs/releasing.md`,部署细节见 `docs/deployment.md`。
