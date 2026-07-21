# ADR 0012: 全容器化开发环境

**状态**: 已接受 (完全取代 ADR 0007 开发部分)

**背景**: ADR 0007 的开发方案(PostgreSQL 容器化,api/web 宿主机跑)要求开发者在宿主机安装 Node.js、pnpm、配置版本,且跨平台一致性弱。CI/本地环境差异导致"works on my machine"问题。

**决策**: 开发环境全容器化,宿主机只需 Docker + git + 编辑器。`docker compose up` 拉起完整开发栈:

1. **依赖安装服务** (`install`): 
   - 一次性服务,按 lockfile hash 幂等(二次 up 不重装;lockfile 变更后自动重装)
   - pnpm store 落仓库内 `.pnpm-store/` (已加 gitignore),node_modules bind-mount 至宿主机供 IDE 读取
   - 支持 `NPM_CONFIG_REGISTRY` 环境变量切换 npm 镜像源(默认官方)

2. **PostgreSQL** (`db`):
   - 沿用 ADR 0007 配置(postgres:17-alpine,健康检查,具名 volume 持久化)
   - 5432 暴露宿主机便于 DBeaver/pgAdmin 直连

3. **API 服务** (`api`):
   - 依赖 install 完成 + db 健康后启动
   - 挂载 Docker socket + host-gateway 供 Testcontainers 起 sibling PostgreSQL 容器(集成测试)
   - 自动执行 `prisma migrate deploy` + `prisma db seed`(幂等)后启动 dev server
   - 支持 `PRISMA_ENGINES_MIRROR` 环境变量(受限网络切镜像)
   - 热重载:宿主机改代码 → 容器内 nodemon 自动重启

4. **Web 服务** (`web`):
   - 端口 5173 暴露,`--host` 绑定 0.0.0.0 供宿主机浏览器访问
   - Vite 代理目标读 `VITE_API_URL` 环境变量(默认 `http://localhost:3000`)
   - 热重载:宿主机改代码 → Vite HMR 生效

5. **Makefile 薄封装**:
   - `make up/down/test/lint/migrate/shell` 代理 docker compose 命令
   - 裸 `make` 列帮助菜单

**影响**:

- ✅ 新人 clone 后 `docker compose up` 即可开发,零宿主机依赖配置
- ✅ CI 与本地环境完全一致(同镜像、同 Node 版本、同 pnpm 版本)
- ✅ 宿主机 IDE 类型解析/跳转正常(node_modules bind-mount)
- ✅ 测试全部容器内跑(含 Testcontainers 集成测试)
- ⚠️  首次 up 需下载镜像 + 安装依赖,约 3-5 分钟(后续秒启)
- ⚠️  Docker Desktop 需配置足够资源(建议 ≥4GB RAM)

**生产部署不变**: ADR 0007 生产部分(`docker-compose.prod.yml`)保持不变,仅影响开发流程。

**废弃**: 
- `pnpm dev` 宿主机启动方式(仍可用,但不推荐)
- 宿主机 Node.js/pnpm 安装要求从 README 移除

**参考**: 
- Issue #112
- Docker Compose 依赖健康检查: https://docs.docker.com/compose/compose-file/05-services/#depends_on
