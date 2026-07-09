# ADR 0006: 技术栈与开发规范

**状态**:已接受

核心取向:**TypeScript 同构**——前后端同语言,`packages/shared` 共享领域类型 / Zod schema / 枚举,把"前后端字段/枚举对不齐"消灭在编译期。二期已明确要后台定时任务(带外推送)与实时通知,要求**常驻后端进程**,排除 Serverless。

| 层 | 选择 | 一句话理由 |
|----|------|-----------|
| 后端 | Node.js + TypeScript + Fastify + tRPC | 同构;内部端到端类型安全零 codegen |
| 数据库 | PostgreSQL + Prisma | 读时时间谓词、timestamptz、JSONB 规则列、FILTER 聚合、SEQUENCE 工单号全是原生能力,ADR 0003/0004/0005 照抄落地;复杂读时查询走视图 + $queryRaw |
| 认证 | Session + httpOnly Cookie(会话存 Postgres) | 改权限/禁用即时生效;`authenticate()` 可插拔,二期飞书 SSO 复用同一 Session 逻辑(users.feishuUserId 预留) |
| 授权 | 权限点扁平字符串(PRD §5.1),角色 = 权限点集合存库 | Fastify preHandler 按路由校验;数据权限在查询层注入——无 view_all 则强制 WHERE assigneeId = 当前用户 |
| 前端 | React + TS + Vite;kibo-ui → shadcn/ui;TanStack Query;react-hook-form + Zod | 组件源码入仓 AI 可改;refetchInterval 承载 30 秒轮询;Zod schema 前后端共享 |
| 图表 / 排班 | shadcn chart(Recharts)/ kibo-ui Gantt | 暗色与主题走同一 CSS 变量 |
| 仓库 | pnpm monorepo:`apps/api` / `apps/web` / `packages/shared` | 一处改两端受益 |

业务逻辑沉入纯 service 层(不依赖 tRPC/HTTP),tRPC procedure 只是薄封装;未来对外 REST 复用同一 service + Zod,内部不动。不为尚无消费者的外部接口提前上 OpenAPI。

**需要长期遵守的约束**(不写下来就会丢的两条):

- **时间处理**:DB 一律 `timestamptz` 存 UTC,展示/计算在边界转东八区(date-fns-tz);**读时时间谓词统一走可注入的 `clock.now()`**,保证可测与口径单一真源。纯绝对时刻比较(如会话过期)用 `new Date()` 即可,不在此列。
- **测试对准高危处**:依赖 Postgres 方言的读时谓词、考核聚合、工单号并发序列、RBAC 守卫,用 Testcontainers 起**真 Postgres** 测(mock/SQLite 测不准);纯 CRUD 透传与纯展示组件少测/不测;Playwright 覆盖 3~5 条关键路径作回归防线。

其余工程细节(Biome、strict tsconfig、pino、Conventional Commits、.env 约定、命名规范)以仓库配置文件与现有代码为准,不在本 ADR 赘述。
