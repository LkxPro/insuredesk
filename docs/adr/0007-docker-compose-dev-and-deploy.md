# ADR 0007: Docker Compose 开发与部署

**状态**:已接受

开发与部署对容器化的诉求不同,拆两个 compose 文件:

- **开发(`docker-compose.yml`)**:只容器化 PostgreSQL(具名 volume 持久化、5432 暴露宿主机便于 GUI 直连),api/web 仍在本机 `pnpm dev` 跑,保留热重载。
- **生产(`docker-compose.prod.yml`)**:Postgres + API 两个服务。前端不单独起容器——API 用 `@fastify/static` 托管 `apps/web/dist` + SPA 回落(当前规模够用,省一个 nginx 容器)。API 只绑 `127.0.0.1:3000`,由宿主机**既有** nginx 反代并负责 HTTPS/域名,不重复造反向代理。
- **迁移一律手动**(开发 `pnpm db:migrate` / 生产 `run --rm api pnpm db:deploy`):契合 Prisma 工作流;生产自动迁移会把"迁移失败"耦合成"服务启动失败",数据库变更应人工可控。

拒绝的方案:单文件 + profile/override(两场景诉求相反,硬塞反而绕)。

具体命令与 nginx 反代配置见 `CLAUDE.md` 与 `docs/deployment.md`。CONTEXT.md 不动——基础设施决策不是领域概念。
