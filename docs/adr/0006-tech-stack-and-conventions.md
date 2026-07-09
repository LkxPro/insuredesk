# ADR 0006: 技术栈与开发规范

## 状态

已接受

## 上下文

PRD/CONTEXT 与 ADR 0001–0005 已把领域模型与业务规则理顺，但尚未确定用什么技术实现、以及团队/AI 协作的开发规范。本 ADR 一次性固化技术栈与工程规范，作为脚手架与后续所有实现的依据。

选型贯穿两条主线：

1. **贴合 PRD 的真实约束**：真数据库/真后端（软删、并发安全工单号序列、SLAPolicy 配置、RBAC、审计日志）、大量"读时计算"的时间谓词（两轨通知 + 看板 + 超时染色，见 ADR 0001/0004）、50+ 并发/列表<1 秒/30 秒轮询、三维 RBAC、Excel 导出、统一东八区。
2. **面向长期演进**：明确的既定路线包含二期的**后台定时任务（带外推送）**与**实时通知（WebSocket/SSE）**。这要求架构能长期容纳一个**常驻后端进程**——直接排除 Serverless 形态。

> 说明：`legacy/` 目录是一版一次性的 GitHub Pages 演示（前端 mock、无真后端），**不作为本次选型的参考**。

一条贯穿全栈的核心取向：**TypeScript 同构** —— 前后端同语言、共享一份类型与校验，把"前后端字段/枚举/接口对不齐"这一整类 bug 消灭在编译期。这对本项目"领域模型复杂（大量枚举、SLAPolicy 嵌套结构、计算状态）但计算不密集"的画像收益最大，也最契合 AI 主力开发（vibe coding）的诉求。

## 决策

### 技术栈

| 层 | 选择 | 关键理由 |
|----|------|---------|
| 架构 | 独立全栈应用 + 常驻后端进程 | 二期 cron + 实时通知要求常驻进程，排除 Serverless |
| 后端语言 | Node.js + TypeScript | 前后端同构，共享类型 |
| 数据库 | PostgreSQL | 读时时间谓词/`timestamptz` 时区/`JSONB` 规则/`COUNT(*) FILTER` 聚合——ADR 0003 的 SQL 可照抄；原生 `SEQUENCE` 出工单号 |
| ORM | Prisma | 占大头的 CRUD 零样板、类型贯穿、迁移成熟；复杂读时查询走 Postgres 视图 + `$queryRaw` |
| Web 框架 | Fastify | 现代、TS 一等公民、schema 校验内建、插件化挂 RBAC、平滑加 WebSocket |
| 认证 | Session + httpOnly Cookie（会话存 Postgres） | 改权限/禁用即时生效；SSO-ready |
| 前端框架 | React + TypeScript · Vite | 同后端心智，admin 生态厚 |
| UI 组件 | kibo-ui（主）→ shadcn/ui（兜底） | 同一基座链（kibo→shadcn→Radix→Tailwind），现代/流畅/原生暗色；组件源码入仓、AI 可改 |
| 图表 | shadcn chart（Recharts 内核） | kibo-ui 无 charts，fallback；React 原生、暗色走同一 CSS 变量 |
| 排班 | kibo-ui Gantt | 行=值班人/渠道、X 轴=日期、格内渲染早/晚班块 |
| 数据请求 | TanStack Query | 内建 `refetchInterval` 承载 30 秒两轨通知轮询 |
| 表单/校验 | react-hook-form + Zod | Zod schema 前后端共享 |
| API 契约 | tRPC | 内部前后端端到端类型安全、零 codegen；service 层 + Zod 预留未来对外 REST |
| 实时通知（二期） | WebSocket/SSE，独立通道 | 不经 HTTP API 层；tRPC/REST 均不受影响 |

### 认证与授权（RBAC）落地

- **认证可插拔**：抽象 `authenticate() → userId`，本期实现账号密码登录；二期飞书 SSO 只新增 OAuth 回调路由（单开普通 REST 路由），拿到飞书身份后走**同一套 Session 建立逻辑**。`users` 表预留可空 `feishuUserId` 绑定位。
- **授权**：权限点为扁平字符串枚举（`ticket.assign` 等，见 PRD §5.1），角色 = 权限点集合、存库、管理员可编辑。后端用 Fastify preHandler 守卫按路由所需权限点校验；数据权限（全部/个人，见 PRD §5.2）在查询层落地——无 `ticket.view_all` 则强制注入 `WHERE assigneeId = 当前用户`。

### 开发规范

- **仓库**：pnpm workspaces monorepo —— `apps/api`（Fastify+tRPC+Prisma）、`apps/web`（Vite+React+kibo）、`packages/shared`（领域类型 + Zod schema + 枚举常量）。共享包被前后端直接 import，一处改两端受益。
- **业务分层**：业务逻辑沉入纯 service 层（不依赖 tRPC/HTTP）；tRPC procedure 只是薄封装。未来对外只需在同一 Fastify 上新增 `/api/v1/*` REST 命名空间，复用同一 service + 同一 Zod（`zod-to-openapi` 生成 OpenAPI），内部 tRPC 不动。
- **lint + format**：Biome（单一 `biome.json`，lint+format 一体）。
- **TS 严格度**：`strict: true` + `noUncheckedIndexedAccess`，统一 base tsconfig。
- **命名**：TS 社区标准——类型/组件 `PascalCase`、变量/函数 `camelCase`、枚举值沿用 PRD（`unassigned`/`follow_up_checkpoint` 等）；前端组件文件 `PascalCase.tsx`，其余 `kebab-case.ts`。
- **时间处理**：DB 一律 `timestamptz` 存 UTC，展示/计算在边界转东八区（`date-fns-tz`）；**禁止裸 `new Date()` 做业务时间判断**，收敛到统一时间工具函数（呼应"判定谓词单一真源"）。
- **环境变量**：`.env`（不入库）+ `.env.example`（入库），启动时用 Zod 校验 `process.env`，缺失即崩。
- **错误处理**：后端 `TRPCError` + 统一 error formatter，Zod 校验错误标准化返回；前端 TanStack Query 统一 error 边界 + toast。
- **日志**：`pino`（Fastify 原生集成），结构化 JSON，请求级 traceId。
- **Git**：Conventional Commits；PR 走 feature 分支，不直接推 `main`。
- **Prisma 迁移**：`migrate dev` 开发 / `migrate deploy` 生产；schema 改动必附迁移；禁止手改已提交的迁移。

### 测试策略

分层，按价值而非覆盖率：

- **后端**：Vitest。依赖 Postgres 的高危查询（读时时间谓词、ADR 0003 考核聚合、工单号并发序列、RBAC 守卫）用 **Testcontainers 起真 Postgres** 测——因为最该保护的正是 Postgres 方言 `$queryRaw`/视图与时区行为，mock/SQLite 测不准。其余 service 逻辑走普通单测。纯 CRUD 透传少测。
- **前端**：Vitest + React Testing Library，只测**有逻辑**的组件（RBAC 显隐、表单 Zod 校验、待办告警染色/计数）；纯展示组件不测。Playwright 覆盖 3~5 条关键路径 E2E（登录→建单→分配→跟进→完结，及权限被拒路径）作为回归防线。

## 理由

1. **同构收益最大化**：Node+TS + monorepo + shared 类型/Zod + tRPC 环环相扣，把"前后端对齐"从"靠纪律"变成"编译器保证"——对复杂领域模型 + AI 高频改动是决定性的。
2. **PostgreSQL 让已想清的设计"照抄落地"**：ADR 0003/0004/0005 的读时时间谓词、条件聚合、JSONB 规则列，在 Postgres 上是原生能力，换 MySQL 则处处改写。
3. **可演进而非过度设计**：tRPC 管内部（高频、要极致同构），service 层 + Zod 预留对外 REST 通道（低频、要标准）。cron 与实时通知走后端内部进程/独立 WS 通道，均不受 API 契约选择影响。为尚未出现且无具体规划的外部消费者现在就上 OpenAPI，是每日多付的税，不划算。
4. **现代化 UI 与暗色是设计原点**：kibo/shadcn 基座的 CSS 变量令 Light/Dark 为一等公民而非补丁；组件源码入仓，AI 可自由修改，vibe coding 生成正确率高。
5. **测试对准高危处**：AI 能高速产出代码，价值在于用真 Postgres 测那几处"逻辑微妙、错了不易察觉"的查询，以及一条能跑通的端到端冒烟。

## 影响

- 需搭建 monorepo 脚手架：`apps/api` / `apps/web` / `packages/shared` + base tsconfig + `biome.json` + `.env.example` + 空 Prisma schema。
- 复杂读时查询集中定义为 Postgres 视图 / repository 函数，作为"时间类判定单一真源"，被后端 + 未来 cron 复用（呼应 ADR 0001/0004）。
- `users` 表新增可空 `feishuUserId`；本期不填，二期 SSO 回填。
- 会话存储本期落 Postgres（不引 Redis）；若二期实时通知/多实例部署需要，再评估引入 Redis 作会话/连接协调。
- CI 需能运行 Docker（Testcontainers 依赖）；若 CI 环境不支持，改用 CI 托管的 Postgres 服务实例。
- 依赖版本在脚手架落地时按当时最新稳定版锁定（pin），不在本 ADR 写死版本号。
