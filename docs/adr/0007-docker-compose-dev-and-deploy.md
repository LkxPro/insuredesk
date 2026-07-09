# ADR 0007: Docker Compose 开发与部署

## 状态

已接受

## 上下文

ADR 0006 固化了技术栈（pnpm monorepo、Fastify+tRPC+Prisma、PostgreSQL、Vite+React），但**开发环境如何拉起、生产如何部署**尚未标准化。两个现实痛点驱动本 ADR：

1. **开发**：每个成员都要在本机装 PostgreSQL，版本/配置容易不一致；新人首次跑起来门槛高。
2. **部署**：直接在服务器上装 Node/Postgres，要操心系统环境、版本、依赖，换机器要重来一遍。

目标是用 Docker Compose 消除这两处环境差异，但**开发和部署对容器化的诉求不同**：开发要保留本机热重载的顺手，部署要的是"不用管服务器环境"的一键可复现。

已知约束：**服务器上已有 nginx**，负责外部流量入口（HTTPS、域名、其他站点），不希望在 compose 里重复造反向代理。

## 决策

拆成**两个 compose 文件**，分别服务两个场景：

### 开发环境（`docker-compose.yml`）

- **只容器化 PostgreSQL**，`apps/api` 与 `apps/web` 仍在本机 `pnpm dev` 跑，保留 tsx/Vite 热重载。
- 数据**持久化**到具名 volume（反复重启容器不丢测试数据；要干净库时 `docker compose down -v`）。
- 端口 `5432:5432` 暴露到宿主机，便于 Prisma Studio / GUI 工具（DataGrip、DBeaver）直连调试。
- 迁移**手动执行**（`pnpm db:migrate`）：契合 Prisma 开发工作流（改 schema → generate → migrate 由开发者显式触发），容器不代管。

首次启动三步（写进 CLAUDE.md 与部署文档）：
```bash
docker compose up -d    # 起 PostgreSQL
pnpm db:migrate         # 应用迁移（首次 / schema 变更后）
pnpm dev                # 起 api + web
```

### 生产部署（`docker-compose.prod.yml`）

- **PostgreSQL + API 两个服务**，均持久化。前端**不单独起容器**：API 用 Fastify `@fastify/static` 直接托管 `apps/web/dist`，`/trpc/*` 走 tRPC、其余路径回落 `index.html`。
- API 镜像走**多阶段构建**（构建阶段 `pnpm install`+`pnpm build`+`prisma generate`，运行阶段只带产物、生产依赖、Prisma schema），基础镜像 `node:22-alpine`，最小化体积与攻击面。
- API 端口**只绑 `127.0.0.1:3000`**，不进公网；由宿主机 nginx 反向代理到它，nginx 负责 HTTPS/域名。
- 迁移**部署前手动执行**（`docker compose -f docker-compose.prod.yml run --rm api pnpm db:deploy`）：与应用启动分离，迁移失败不影响在运行的服务，敏感操作人工可控。
- 环境变量由**服务器上手动创建的 `.env`** 提供（`env_file` 引用），不入库。

## 理由

1. **开发与部署诉求不同，就该用不同文件**：开发要热重载 → 只容器化 Postgres；部署要可复现 → 整体容器化。硬塞进一个文件用 profile/override 反而绕。
2. **单容器托管前端，匹配当前规模**：内部客服系统、50+ 并发、单机部署，Fastify `@fastify/static` 完全够用，省掉一个 nginx 容器和一层反代配置。未来真要前后端分离再拆不迟。
3. **不重复造反向代理**：服务器已有 nginx 管 HTTPS/域名，compose 只暴露 `127.0.0.1:3000` 给它反代，职责边界清晰、攻击面最小。
4. **迁移一律手动**：开发端契合 Prisma 工作流，生产端契合"数据库变更需人工审核"的谨慎原则；自动迁移看似方便，但改 schema 时容器并不会自动感知，且生产自动迁移会把"迁移失败"耦合成"服务启动失败"。
5. **多阶段构建**：单机部署也应遵循镜像最小化——拉取快、占用少、不带 devDependencies 与源码。

## 影响

- 新增文件：`docker-compose.yml`、`docker-compose.prod.yml`、`apps/api/Dockerfile`、`.dockerignore`、`docs/deployment.md`（含 nginx 反代配置示例）。
- `.env.example` 补充生产相关变量说明（如 Postgres 容器的 `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB`，以及生产 `DATABASE_URL` 指向容器服务名而非 localhost）。
- `CLAUDE.md` 新增 Development section：起环境命令 + 指向 `docs/deployment.md`（因为"没先起数据库容器"是新 session 的最高频卡点）。
- API 需实现用 `@fastify/static` 托管前端产物 + SPA 路由回落（本 ADR 定方向，具体实现随 issue 落地）；开发态该托管不启用（Vite 自带 dev server）。
- 生产 `DATABASE_URL` 的 host 为 compose 服务名（如 `db`），与开发态的 `localhost:5432` 不同——由各自 `.env` 区分。
- CONTEXT.md **不动**：Docker 化是基础设施决策，非领域概念，保持 CONTEXT.md 作为领域语言单一真源的纯粹性（与 ADR 0006 技术栈决策同样不写入 CONTEXT.md）。
- 依赖版本（Postgres 镜像 tag 等）在实现落地时按当时最新稳定版锁定，不在本 ADR 写死。
