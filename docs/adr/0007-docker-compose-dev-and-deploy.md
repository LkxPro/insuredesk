# ADR 0007: Docker Compose 开发与部署

**状态**:已接受(生产更新流程被 ADR 0009 修订:钉版本镜像部署取代 git pull + 本地构建)

开发与部署对容器化的诉求不同,拆两个 compose 文件:

- **开发(`docker-compose.yml`)**:只容器化 PostgreSQL(具名 volume 持久化、5432 暴露宿主机便于 GUI 直连),api/web 仍在本机 `pnpm dev` 跑,保留热重载。
- **生产(`docker-compose.prod.yml`)**:Postgres + API 两个服务。前端不单独起容器——API 用 `@fastify/static` 托管 `apps/web/dist` + SPA 回落(当前规模够用,省一个 nginx 容器)。API 只绑 `127.0.0.1:3000`,由宿主机**既有** nginx 反代并负责 HTTPS/域名,不重复造反向代理。
- **迁移与初始化随启动自动执行**:生产 API 容器的启动链为 `prisma migrate deploy` → bootstrap(幂等;初始账号硬编码 admin/admin,部署后立即改密码)→ 起服务;开发 `pnpm dev` 先跑 `migrate deploy`,users 表为空时再自动 seed(非空不 seed,避免每次重启替换演示工单)。接受"迁移失败 = 启动失败"的耦合,fail fast 后看容器日志排查;`pnpm db:migrate`(`prisma migrate dev`)仅保留给改 schema 时生成迁移文件。

拒绝的方案:单文件 + profile/override(两场景诉求相反,硬塞反而绕)。

具体命令与 nginx 反代配置见 `CLAUDE.md` 与 `docs/deployment.md`。CONTEXT.md 不动——基础设施决策不是领域概念。
