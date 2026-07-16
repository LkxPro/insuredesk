# 部署

单机部署（ADR 0007）:compose 起 Postgres + API 两个容器,API 同时托管构建好的
前端 SPA(`@fastify/static`),只绑 `127.0.0.1:3000`,由宿主机既有 nginx 反代并
负责 HTTPS 与域名。

## 开发环境

前置:Node ≥ 22(`corepack enable`,pnpm 版本由 `packageManager` 字段锁定)、
Docker。

```bash
docker compose up -d                       # 只容器化 PostgreSQL
cp apps/api/.env.example apps/api/.env     # 默认值即可直接用
pnpm install
pnpm dev
```

`pnpm dev` 会先跑 `prisma migrate deploy`(users 表为空时自动 seed),再并行起
api(3000)与 web(5173,`/trpc` 和 `/api` 代理到 api)。浏览器访问
<http://localhost:5173>。

- 清库重来:`docker compose down -v` 后重新 `pnpm dev`。
- 改 schema:`pnpm db:migrate`(生成并应用迁移文件)。

## 生产部署(首次)

服务器前置:Docker(含 Compose 插件)、git、已配置好的 nginx。

```bash
git clone https://github.com/LkxPro/insuredesk.git && cd insuredesk
cp .env.example .env
```

编辑 `.env` 填入真实值(该文件不进版本库):

- `POSTGRES_PASSWORD` 换成强密码,且 `DATABASE_URL` 中的账号密码与之一致——
  主机名必须是 compose 服务名 `db`,不是 localhost。
- `SESSION_SECRET` 用 `openssl rand -hex 32` 生成。
- `NODE_ENV` 保持 `production`(启用 SPA 静态托管与 Secure cookie)。

构建并启动:

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

API 容器的启动链为 `prisma migrate deploy` → bootstrap(幂等,创建初始账号
admin/admin)→ 起服务。`curl -I http://127.0.0.1:3000` 验证存活,配好 nginx 后
**立即登录修改 admin 密码**。

## 更新已部署的服务

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

这两步就是完整流程:

- `--build` 重建 api 镜像,前端 SPA 在构建阶段一并打进镜像,前后端更新都由这
  一次重建覆盖。
- 数据库迁移随容器启动自动执行,无需手动操作。迁移失败会导致容器起不来
  (fail fast),用 `docker logs insuredesk-api-prod` 排查。
- 数据不受影响:db 容器镜像未变不会重建,数据持久化在具名卷
  `insuredesk_postgres_data_prod` 中。
- 新版本若引入新环境变量,先补进服务器上的 `.env` 再执行以上命令(对照
  `.env.example` 的 diff)。

旧镜像会残留为 dangling image,定期 `docker image prune -f` 清理。

## 宿主机 nginx 反代

API 只监听回环地址,公网流量全部经宿主机 nginx。`NODE_ENV=production` 下
session cookie 带 `Secure` 标记,**必须走 HTTPS**,否则浏览器不回传 cookie、
无法保持登录态。

```nginx
server {
    listen 443 ssl;
    server_name insuredesk.example.com;

    # ssl_certificate / ssl_certificate_key 由 certbot 等工具管理,此处从略

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name insuredesk.example.com;
    return 301 https://$host$request_uri;
}
```

## Building behind a restricted network(受限网络下构建)

npmjs.org / binaries.prisma.sh 不可达的网络(如中国大陆服务器)下构建镜像时,
在 `.env` 中取消注释镜像源配置,compose 会在构建时作为 build args 注入
Dockerfile(只影响构建,不影响运行时):

```bash
NPM_REGISTRY="https://registry.npmmirror.com"
PRISMA_ENGINES_MIRROR="https://registry.npmmirror.com/-/binary/prisma"
```

## 故障排查

- 容器反复重启:`docker logs insuredesk-api-prod`,多为迁移失败或
  `DATABASE_URL` 配错。
- 看服务状态:`docker compose -f docker-compose.prod.yml ps`(db 带健康检查)。
- 彻底重置(**丢弃全部数据**):`docker compose -f docker-compose.prod.yml down -v`
  后重新 `up -d --build`。
