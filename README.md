# InsureDesk

保险行业客服工单系统：统一受理多渠道客户投诉/咨询/理赔请求，按投诉等级驱动
SLA，跟踪工单全生命周期。

技术栈：Fastify + tRPC + Prisma / PostgreSQL；React + Vite + Tailwind CSS；
pnpm monorepo（`apps/api`、`apps/web`、`packages/shared`）。

## 快速开始

前置：Docker + git + 编辑器（无需安装 Node/pnpm）。

```bash
docker compose up -d    # 首次会自动安装依赖、迁移数据库、seed、启动服务
```

全容器化开发环境（ADR 0012）：依赖安装、PostgreSQL、api（3000）、web（5173）
全部运行在容器内，支持热重载。浏览器访问 <http://localhost:5173>。

常用命令（Makefile 封装）：
```bash
make          # 列出所有可用命令
make test     # 运行测试（容器内）
make lint     # 运行 linter
make migrate  # 应用数据库迁移
make shell    # 进入 api 容器 shell
```

- 清库重来：`docker compose down -v` 后重新 `docker compose up -d`。
- 改 schema：先 `pnpm db:migrate` 生成迁移文件，再 `make migrate` 应用（或重启 api 服务）。
- 受限网络：在根目录创建 `.env` 设置 `NPM_CONFIG_REGISTRY` 和 `PRISMA_ENGINES_MIRROR` 切换镜像源。

## 文档

- [部署](docs/deployment.md) — 生产部署、备份恢复与 nginx 反代
- [发版](docs/releasing.md) — CalVer 发版与升级操作手册
- [领域词汇表](CONTEXT.md) — 核心概念与业务口径
- [ADR](docs/adr/) — 关键架构决策
