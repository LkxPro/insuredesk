# InsureDesk

保险行业客服工单系统：统一受理多渠道客户投诉/咨询/理赔请求，按投诉等级驱动
SLA，跟踪工单全生命周期。

技术栈：Fastify + tRPC + Prisma / PostgreSQL；React + Vite + Tailwind CSS；
pnpm monorepo（`apps/api`、`apps/web`、`packages/shared`）。

## 快速开始

前置：Docker、git、[nvm](https://github.com/nvm-sh/nvm)、编辑器。

```bash
nvm use              # 切换到项目钉定的 Node 版本（读取 .nvmrc）
corepack enable      # 启用 pnpm（只需一次，corepack 自动读取 packageManager 字段）
make dev             # 一键启动：安装依赖 → 启动 db → 迁移 + seed → 并行 api+web
```

开发环境：PostgreSQL 容器化（5432），api 和 web 在宿主机跑（3000 / 5173），支持热重载。
浏览器访问 [http://localhost:5173](http://localhost:5173)。

常用命令（Makefile 封装）：

```bash
make             # 列出所有可用命令
make dev         # 启动开发环境（幂等，Ctrl-C 停前后台，db 常驻）
make down        # 停止 db 容器
make db-reset    # 清库重来（删 volume + 重新创建）
make test        # 运行测试
make typecheck   # 类型检查
make lint        # 运行 linter
make check       # CI 全套检查（push 前本地跑一遍）
```

- 清库重来：`make db-reset` 后重新 `make dev`。
- 改 schema：在 `apps/api/prisma/schema.prisma` 修改后，运行 `cd apps/api && pnpm db:migrate` 生成迁移文件并应用到开发库。下次启动 api 会自动应用。
- 切分支撞 schema：`make db-reset` 重建库（additive migration 通常无需此步）。
- 受限网络：`pnpm config set registry <镜像地址>` 切换 npm 源；Prisma 下载引擎认 `PRISMA_ENGINES_MIRROR` 环境变量。
- 并行 worktree（`.worktrees/…`）：一律用 `make dev` 启动。每个 worktree 按工程名 hash 分配独立端口（db / api / web），互不冲突。主仓库沿用默认端口（5432 / 3000 / 5173）。



## 文档

- [部署](docs/deployment.md) — 生产部署、备份恢复与 nginx 反代
- [发版](docs/releasing.md) — CalVer 发版与升级操作手册
- [领域词汇表](CONTEXT.md) — 核心概念与业务口径

