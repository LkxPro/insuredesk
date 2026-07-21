# ADR 0007: Docker Compose 开发与部署

**状态**:已接受

开发与部署对容器化的诉求不同,拆两个 compose 文件:

- **开发(`docker-compose.yml`)**:全容器化,宿主机只需 Docker + git + 编辑器,`docker compose up` 拉起完整开发栈:
  - `install`:一次性依赖安装,lockfile 不变则幂等跳过;pnpm store 落具名 volume,node_modules 随仓库 bind-mount 至宿主机供 IDE 读取;`NPM_CONFIG_REGISTRY` 可切 npm 镜像源。
  - `db`:PostgreSQL 17(健康检查、具名 volume 持久化),5432 暴露宿主机便于 GUI 直连。
  - `api`:待 install 完成且 db 健康后启动,先 `prisma migrate deploy` + seed 再起 dev server,热重载;挂载 Docker socket + host-gateway,供 Testcontainers 起 sibling Postgres 容器跑集成测试。
  - `web`:Vite `--host` 绑 0.0.0.0,5173 暴露宿主机,热重载。
  - Node/pnpm 版本的事实源收敛于开发镜像 tag 与根 `package.json` 的 `packageManager` 字段,CI 复用同一 compose 服务跑全部检查,不另装工具链。
  - `Makefile` 薄封装常用命令(up/down/test/lint/migrate/shell)。
- **生产(`docker-compose.prod.yml`)**:Postgres + API 两个服务。前端不单独起容器——API 用 `@fastify/static` 托管 `apps/web/dist` + SPA 回落(当前规模够用,省一个 nginx 容器)。API 只绑 `127.0.0.1:3000`,由宿主机**既有** nginx 反代并负责 HTTPS/域名,不重复造反向代理。
- **迁移与初始化随启动自动执行**:生产 API 容器的启动链为 `prisma migrate deploy` → bootstrap(幂等;初始账号硬编码 admin/admin,部署后立即改密码)→ 起服务;开发 api 容器同理,出厂 seed(角色、SLA 策略、班次目录、初始账号)随启动幂等执行,演示工单仅在 users 表为空时灌入(非空不 seed,避免每次重启替换演示工单)。接受"迁移失败 = 启动失败"的耦合,fail fast 后看容器日志排查;`prisma migrate dev`(容器内 `pnpm db:migrate`)仅保留给改 schema 时生成迁移文件。

拒绝的方案:单文件 + profile/override(两场景诉求相反,硬塞反而绕);开发在宿主机直装 Node/pnpm(跨平台一致性弱,CI 与本地环境漂移)。

具体命令与 nginx 反代配置见 `README.md` 与 `docs/deployment.md`。CONTEXT.md 不动——基础设施决策不是领域概念。
