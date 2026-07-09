# InsureDesk

InsureDesk 是一个保险客服工单系统，用来统一受理客户投诉、咨询、理赔请求，并按投诉等级驱动 SLA、提醒、分配和处理记录。

这份文档面向第一次接手项目的人：先让你把本地环境跑起来，再告诉你常用命令、代码结构、数据库迁移和生产部署怎么做。更细的部署 runbook 在 [docs/deployment.md](docs/deployment.md)，领域词汇在 [CONTEXT.md](CONTEXT.md)。

## 技术栈

- Monorepo: pnpm workspace
- API: Fastify + tRPC + Prisma + PostgreSQL
- Web: React + Vite + React Router + TanStack Query + Tailwind CSS
- Shared: `packages/shared` 放前后端共用的 Zod schema、枚举、权限和 SLA 规则
- Dev database: Docker Compose 只跑 PostgreSQL，应用在宿主机跑热更新
- Production: Docker Compose 跑 PostgreSQL + API，API 同时服务构建后的 Web SPA，宿主机 nginx 反代到 API

## 目录结构

```text
apps/api/              Fastify API、tRPC routers、Prisma schema/migrations/seed
apps/web/              React 前端
packages/shared/       前后端共享类型、schema、枚举、权限、SLA 规则
docs/                  部署文档、ADR、agent 约定
CONTEXT.md             领域词汇和关键规则
PRD.md                 产品需求细节
docker-compose.yml     本地开发 PostgreSQL
docker-compose.prod.yml 单机生产部署
```

## 本地开发

### 1. 准备依赖

需要：

- Node.js 22+
- pnpm 11.7.0, 通常由 corepack 按 `packageManager` 自动处理
- Docker + Docker Compose

安装依赖：

```bash
corepack enable
pnpm install
```

准备 API 环境变量：

```bash
cp apps/api/.env.example apps/api/.env
```

默认 `apps/api/.env.example` 已经匹配本地 `docker-compose.yml` 的 PostgreSQL 账号密码，第一次跑本地开发通常不用改。

### 2. 启动数据库、迁移、填充演示数据

```bash
docker compose up -d
pnpm db:migrate
pnpm db:seed
```

`pnpm db:seed` 会创建演示账号、角色、SLA 策略和 12 张演示工单。演示账号：

```text
admin / password123
manager / password123
cs1 / password123
observer / password123
```

演示工单使用 `DEMO-POL-*` 保单号。重复运行 seed 会替换这 12 张演示工单，不会无限累加。

### 3. 启动应用

```bash
pnpm dev
```

默认地址：

- Web: http://localhost:5173
- API: http://localhost:3000
- PostgreSQL: localhost:5432

开发模式下 Vite 负责前端热更新，并把 `/trpc` 和 `/api` 代理到 API。API 不负责服务前端静态文件，只有生产模式才会服务 `apps/web/dist`。

## 常用命令

| Command | 用途 |
| --- | --- |
| `pnpm dev` | 同时启动 API 和 Web 开发服务器 |
| `pnpm build` | 构建/检查所有 workspace |
| `pnpm test` | 跑 API + Web 测试 |
| `pnpm typecheck` | 跑 TypeScript 检查 |
| `pnpm lint` | 跑 Biome 检查 |
| `pnpm format` | 格式化代码 |
| `pnpm db:migrate` | 开发环境执行 Prisma migration |
| `pnpm db:seed` | 填充演示账号、SLA 和工单 |
| `pnpm db:deploy` | 生产环境应用已提交的 migrations |
| `pnpm --filter @insuredesk/api run db:studio` | 打开 Prisma Studio |

## 数据库工作流

### 拉取上游后

如果上游有 schema 或 migration 变化：

```bash
docker compose up -d
pnpm db:migrate
pnpm db:seed
```

### 清空本地数据库

本地数据不需要保留时：

```bash
docker compose down -v
docker compose up -d
pnpm db:migrate
pnpm db:seed
```

`docker compose down -v` 会删除 PostgreSQL 数据卷。

### 修改 Prisma schema

1. 修改 [apps/api/prisma/schema.prisma](apps/api/prisma/schema.prisma)
2. 创建并应用 migration：

   ```bash
   pnpm db:migrate
   ```

3. 必要时更新 [apps/api/prisma/seed-data.ts](apps/api/prisma/seed-data.ts)
4. 跑检查：

   ```bash
   pnpm typecheck
   pnpm test
   ```

生产环境不要用 `migrate dev`，只用 `pnpm db:deploy` 或容器里的等价命令。

## 开发约定

- 领域枚举、表单 schema、API 输入输出类型优先放在 `packages/shared`，避免前后端漂移。
- API route 尽量保持薄，业务规则放在 `apps/api/src/services/*`。
- 工单状态只有 `unassigned`、`assigned`、`processing`、`completed` 入库；`pending_timeout` 和 `overdue` 是读时计算状态。
- `dueAt` 在创建工单时固定，分配/改派不重算。
- 手工创建工单会记录 `creatorId`；外部来源工单通过 `source` 派生“由谁创建”。
- ProcessLog 记录当时发生的事实，姓名是快照。

更多领域规则见 [CONTEXT.md](CONTEXT.md) 和 [docs/adr](docs/adr)。

## 测试与检查

提交前建议至少跑：

```bash
pnpm lint
pnpm typecheck
pnpm test
```

API 集成测试会使用 Testcontainers 启动真实 PostgreSQL，因此需要 Docker 可用。

## 生产部署

详细 runbook 见 [docs/deployment.md](docs/deployment.md)。这里是最短路径。

### 1. 准备服务器

服务器需要：

- Docker + Docker Compose
- 宿主机 nginx，用来把公网 HTTPS 流量反代到 `127.0.0.1:3000`
- 项目代码仓库

### 2. 创建生产 `.env`

在服务器项目根目录：

```bash
cp .env.example .env
```

至少要改：

```text
POSTGRES_PASSWORD
DATABASE_URL
SESSION_SECRET
NODE_ENV=production
```

注意生产 `DATABASE_URL` 里的 host 是 Compose 服务名 `db`，不是 `localhost`。

可以这样生成 session secret：

```bash
openssl rand -hex 32
```

### 3. 构建并启动服务

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

生产 Compose 会启动：

- `db`: PostgreSQL，不暴露主机端口
- `api`: API + Web SPA，绑定到宿主机 `127.0.0.1:3000`

### 4. 执行数据库迁移

```bash
docker compose -f docker-compose.prod.yml run --rm api pnpm db:deploy
```

迁移是手动步骤，不在容器启动时自动执行。

### 5. 配置 nginx

nginx 把公网域名反代到：

```text
http://127.0.0.1:3000
```

示例配置见 [docs/deployment.md](docs/deployment.md#host-nginx-reverse-proxy-example)。

### 6. 以后发布新版本

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml run --rm api pnpm db:deploy
```

如果本次没有数据库 migration，最后一步可以跳过。

## 常见问题

### 登录提示 `Invalid username or password`

通常是迁移后没跑 seed：

```bash
pnpm db:seed
```

### API 启动时报环境变量错误

检查 `apps/api/.env` 是否存在，以及 `SESSION_SECRET` 是否至少 32 个字符。

### `pnpm db:migrate` 连不上数据库

先确认 PostgreSQL 容器在跑：

```bash
docker compose ps
docker compose up -d
```

### 端口冲突

默认端口：

- PostgreSQL: `5432`
- API: `3000`
- Web: `5173`

如果本机已有服务占用，需要改 `apps/api/.env` 或 Vite 配置。

### Testcontainers 测试失败

确认 Docker daemon 正常运行。API 集成测试依赖真实 PostgreSQL 容器。

