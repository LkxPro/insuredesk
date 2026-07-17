# 部署

单机部署（ADR 0007）:compose 起 Postgres + API 两个容器,API 同时托管构建好的
前端 SPA(`@fastify/static`),只绑 `127.0.0.1:3000`,由宿主机既有 nginx 反代并
负责 HTTPS 与域名。API 跑 GHCR 上的发版镜像,版本由 `.env` 的 `IMAGE_TAG`
钉定(ADR 0009,操作手册见 `docs/releasing.md`)。

开发环境见根目录 `README.md`。

## 生产部署(首次)

服务器前置:Docker(含 Compose 插件)、git、已配置好的 nginx。

```bash
git clone https://github.com/LkxPro/insuredesk.git && cd insuredesk
cp .env.example .env
```

编辑 `.env` 填入真实值(该文件不进版本库):

- `POSTGRES_PASSWORD` 换成强密码,且 `DATABASE_URL` 中的账号密码与之一致——
  主机名必须是 compose 服务名 `insuredesk-db-prod`,不是 localhost。
- `SESSION_SECRET` 用 `openssl rand -hex 32` 生成。
- `NODE_ENV` 保持 `production`(启用 SPA 静态托管与 Secure cookie)。
- `IMAGE_TAG` 填要部署的版本号,取 GitHub Releases 页面上最新的 tag
  (如 `v2026.07.0`)。

### 登录 GHCR(拉取私有镜像)

仓库与镜像均为私有,服务器拉镜像前需用 GitHub PAT 登录一次(凭据存入
`~/.docker/config.json`,之后无需重复):

1. GitHub → Settings → Developer settings → Personal access tokens →
   Tokens (classic),新建仅含 `read:packages` 权限的 token。
2. 在服务器上登录:

```bash
echo "$GHCR_PAT" | docker login ghcr.io -u LkxPro --password-stdin
```

### 拉取并启动

```bash
docker compose -f docker-compose.prod.yml pull insuredesk-api-prod
docker compose -f docker-compose.prod.yml up -d
```

GHCR 拉不动(受限网络)时走本地构建退路:
`git fetch --tags && git checkout $IMAGE_TAG` 后
`docker compose -f docker-compose.prod.yml up -d --build`,产物与发版镜像
同源、镜像名相同(构建慢时先按下文取消注释 `.env` 中的镜像源配置)。

API 容器的启动链为 `prisma migrate deploy` → bootstrap(幂等,创建初始账号
admin/admin)→ 起服务。`curl -I http://127.0.0.1:3000` 验证存活,配好 nginx 后
**立即登录修改 admin 密码**。

## 更新已部署的服务

升级、回滚的完整操作口径见 `docs/releasing.md`,要点:

- 升级 = 升级前手动备份一次数据库 → 改 `.env` 里的 `IMAGE_TAG` 为新 tag →
  `pull insuredesk-api-prod` → `up -d`。**只前滚**:镜像回滚仅限新版起不来且迁移未执行的
  场景,迁移已执行后发现问题一律发 hotfix 版本(ADR 0009)。
- 数据库迁移随容器启动自动执行,无需手动操作。迁移失败会导致容器起不来
  (fail fast),用 `docker logs insuredesk-api-prod` 排查。
- 数据不受影响:db 容器镜像未变不会重建,数据持久化在具名卷
  `insuredesk_postgres_data_prod` 中。
- 新版本若引入新环境变量,先补进服务器上的 `.env` 再拉起(对照
  `.env.example` 的 diff;Release notes 顶部会标注部署注意事项)。

旧镜像会残留,定期 `docker image prune -f` 清理。

## 备份与恢复

每日备份由宿主机 cron 调 `scripts/backup-db.sh` 完成:从 db 容器 `pg_dump`
后 gzip 存到本机 `~/backups/insuredesk/`,保留 14 天。**已知风险:仅本机
备份、无异地副本,机器级故障(磁盘损坏、入侵、机房事故)= 数据全失**
(ADR 0009 明确接受,异地同步留作后续升级项)。

### 配置每日备份(首次部署后一次性)

脚本随仓库分发,服务器上的 clone 目录里即有。先手动跑一次验证(同时建出
cron 日志要写入的备份目录):输出 `backup ok: …` 且备份目录出现
`insuredesk-<时间戳>.sql.gz` 即正常。

```bash
~/insuredesk/scripts/backup-db.sh
```

然后 `crontab -e` 加一行(路径按实际 clone 位置调整):

```cron
10 3 * * * /home/deploy/insuredesk/scripts/backup-db.sh >> /home/deploy/backups/insuredesk/backup.log 2>&1
```

脚本可重复执行,升级前的固定手动备份(见 `docs/releasing.md`)也直接调它。

### 从备份恢复

适用于灾难性故障(ADR 0009"只前滚"策略的最后兜底)。**恢复会把数据库
整体回退到备份时刻,备份之后的数据全部丢失。**

```bash
cd ~/insuredesk

# 1. 停 API(保持 db 运行),避免恢复期间有写入
docker compose -f docker-compose.prod.yml stop insuredesk-api-prod

# 2. 重建数据库后灌入备份(psql 遇错即停,避免半截恢复被误认成功)
docker exec insuredesk-db-prod sh -c 'dropdb -U "$POSTGRES_USER" "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
gunzip -c ~/backups/insuredesk/insuredesk-<时间戳>.sql.gz \
  | docker exec -i insuredesk-db-prod sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" "$POSTGRES_DB"'

# 3. 把 .env 的 IMAGE_TAG 钉到备份时刻对应的版本再拉起——新版镜像可能
#    携带备份里没有的迁移,直接起新版会让迁移在恢复出的旧数据上重放
sed -i 's/^IMAGE_TAG=.*/IMAGE_TAG=<备份时刻的 tag>/' .env
docker compose -f docker-compose.prod.yml up -d
```

`curl -I http://127.0.0.1:3000` 验证存活,再登录抽查数据是否为备份时刻的
状态。确认无误后按正常升级流程前滚回最新版本。

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

正常升级只 pull 镜像、不在服务器上构建;本节仅适用于 GHCR 拉不动时的本地
构建退路。npmjs.org / binaries.prisma.sh 不可达的网络(如中国大陆服务器)下
构建镜像时,在 `.env` 中取消注释镜像源配置,compose 会在构建时作为 build
args 注入 Dockerfile(只影响构建,不影响运行时):

```bash
NPM_REGISTRY="https://registry.npmmirror.com"
PRISMA_ENGINES_MIRROR="https://registry.npmmirror.com/-/binary/prisma"
```

## 故障排查

- 容器反复重启:`docker logs insuredesk-api-prod`,多为迁移失败或
  `DATABASE_URL` 配错。
- 看服务状态:`docker compose -f docker-compose.prod.yml ps`(db 带健康检查)。
- 彻底重置(**丢弃全部数据**):`docker compose -f docker-compose.prod.yml down -v`
  后重新 `up -d`。
