# InsureDesk

保险行业客服工单系统：统一受理多渠道客户投诉/咨询/理赔请求，按投诉等级驱动
SLA，跟踪工单全生命周期。

技术栈：Fastify + tRPC + Prisma / PostgreSQL；React + Vite + Tailwind CSS；
pnpm monorepo（`apps/api`、`apps/web`、`packages/shared`）。

## 快速开始

前置：Node ≥ 22（`corepack enable`，pnpm 版本由 `packageManager` 字段锁定）、
Docker。

```bash
docker compose up -d                       # 只容器化 PostgreSQL
cp apps/api/.env.example apps/api/.env     # 默认值即可直接用
pnpm install
pnpm dev
```

`pnpm dev` 会先跑 `prisma migrate deploy`（users 表为空时自动 seed），再并行起
api（3000）与 web（5173，`/trpc` 和 `/api` 代理到 api）。浏览器访问
<http://localhost:5173>。

- 清库重来：`docker compose down -v` 后重新 `pnpm dev`。
- 改 schema：`pnpm db:migrate`（生成并应用迁移文件）。

## 文档

- [部署](docs/deployment.md) — 生产部署、备份恢复与 nginx 反代
- [发版](docs/releasing.md) — CalVer 发版与升级操作手册
- [领域词汇表](CONTEXT.md) — 核心概念与业务口径
- [ADR](docs/adr/) — 关键架构决策
