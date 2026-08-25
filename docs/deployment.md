# 部署

单机部署:compose 起 Postgres + API 两个容器,API 同时托管构建好的
前端 SPA(`@fastify/static`),只绑 `127.0.0.1:3000`,由宿主机既有 nginx 反代并
负责 HTTPS 与域名。API 跑 GHCR 上的发版镜像,版本由 `.env` 的 `IMAGE_TAG`
钉定(操作手册见 `docs/releasing.md`)。

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

`up -d` 同时拉起 backup sidecar,每日备份零手工配置即生效——验证方式见下
「备份与恢复」。

## 更新已部署的服务

升级、回滚的完整操作口径见 `docs/releasing.md`,要点:

- 升级 = `make upgrade`。一条命令解析最新 CalVer、迁前备份并校验、把 `.env`
  的 `IMAGE_TAG` 钉成那个具体 tag、`pull` + `up -d`;已是最新则直接退出、无
  副作用。操作员不手敲版本号,`make upgrade` 是唯一 sanctioned 升级路径——手改
  `IMAGE_TAG` 后直接 `up -d` 会让迁移无备份执行(已知风险)。**只前滚**:
  镜像回滚(把 `.env` 里的 `IMAGE_TAG` 改回上一个 tag 再 `up -d`)仅限新版起不来
  且迁移未执行的场景,迁移已执行后发现问题一律发 hotfix 版本。
- 数据库迁移随容器启动自动执行,无需手动操作。迁移失败会导致容器起不来
  (fail fast),用 `docker logs insuredesk-api-prod` 排查。
- 数据不受影响:db 容器镜像未变不会重建,数据持久化在具名卷
  `insuredesk_postgres_data_prod` 中。
- 新版本若引入新环境变量,先补进服务器上的 `.env` 再 `make upgrade`(对照
  `.env.example` 的 diff;Release notes 顶部会标注部署注意事项)。

旧镜像会残留,定期 `docker image prune -f` 清理。

## 联调测试环境(test.insuredesk.jetmobo.com)

与 prod 同机隔离部署:独立 compose project(`insuredesk-test`)、独立容器
(`insuredesk-api-test` / `insuredesk-db-test`)、独立数据卷、独立凭证
(`.env.test`)。镜像走 CI test 通道——main 每次合并自动推
`ghcr.io/lkxpro/insuredesk-api:test`(及 `:test-<shortsha>`),与 release
发版完全解耦。首启同样自动 migrate + bootstrap(admin/admin,登录后改密码)。

前置(一次性,人工):DNS A 记录 `test.insuredesk.jetmobo.com` 指向服务器;
caddy 的 Caddyfile 加一个站点块(caddy 与 api-test 同在 `insuredesk_default`
网络,按容器名转发,LE 证书自动签):

```
test.insuredesk.jetmobo.com {
    encode zstd gzip
    reverse_proxy insuredesk-api-test:3000 {
        header_up Host {host}
        header_up X-Real-IP {remote_host}
    }
}
```

### 首次部署

```bash
cd /home/hermes/compose/insuredesk
git pull
cp .env.test.example .env.test   # 填真实值,凭证与 prod 完全独立
docker compose --env-file .env.test -f docker-compose.test.yml pull
docker compose --env-file .env.test -f docker-compose.test.yml up -d
```

`curl -I http://127.0.0.1:3001` 验证存活(宿主回环 3001 映射容器 3000)。

### 日常更新(main 最新)

```bash
git pull
docker compose --env-file .env.test -f docker-compose.test.yml pull
docker compose --env-file .env.test -f docker-compose.test.yml up -d
```

更新时机由人控制(联调中重启会断对方会话),不上自动滚动。

### 联调未合并的分支(本地 build 逃生舱)

```bash
git checkout <branch>
docker compose --env-file .env.test -f docker-compose.test.yml up -d --build
# 联调完回到 test 通道:git checkout main && 重新 pull + up -d(不带 --build)
```

注意:`up -d --build` 后镜像停留在本地构建产物,显式 `pull` 才会回到 GHCR
的 `:test`。

### 重置(丢弃全部测试数据)

```bash
docker compose --env-file .env.test -f docker-compose.test.yml down -v
docker compose --env-file .env.test -f docker-compose.test.yml up -d
```

骏伯对接:推送地址配 `https://test.insuredesk.jetmobo.com/api/integrations/jb-insurance/work-orders`,
token 用 `.env.test` 里独立的一套;`JB_INSURANCE_CALLBACK_URL` 留空则回调
投递空转。

## 备份与恢复

每日备份由 backup sidecar 完成,不再依赖宿主机 cron:`up -d` 起的
`postgres:17-alpine` sidecar 经 compose 网络 `pg_dump -h insuredesk-db-prod`,
gzip 落宿主机 `~/backups/insuredesk/`(可用 `.env` 的 `BACKUP_DIR` 改),保留
14 天。容器启动即备份一次(自证可用),之后内置 crond 按 `TZ=Asia/Shanghai`
每晚 21:30 再跑。**已知风险:仅本机备份、无异地副本,机器级故障(磁盘损坏、
入侵、机房事故)= 数据全失**(已明确接受,异地同步留作后续升级项)。

### 验证备份在跑

sidecar 随 `up -d` 一起拉起,零手工配置。确认三处:

- `docker compose -f docker-compose.prod.yml ps` 中 `backup` 显示 `healthy`
  ——healthcheck 断言 25h 内产出过新备份文件,`unhealthy` 即备份停摆
  (sidecar 崩了、或连不上 db)。仅被动可见、不主动告警(已知风险),
  故需在登服务器时顺手扫一眼这里。
- 备份目录出现 `insuredesk-<时间戳>.sql.gz`:`ls -lh ~/backups/insuredesk/`。
- sidecar 日志:`docker logs insuredesk-backup-prod`——启动备份与每晚 cron
  的 `backup ok: …` 都在这。

### 手动备份一次

`make upgrade` 已把迁前备份焊进升级流程(自动跑同一条命令并校验产出),无需
手动。临时需要额外备份时用:

```bash
docker compose -f docker-compose.prod.yml run --rm backup once
```

与每日备份、迁前备份同一脚本、同一份逻辑,落同一目录。

### 从备份恢复

适用于灾难性故障(「只前滚」策略的最后兜底)。**恢复会把数据库
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

### 每季度恢复演练(运维流程)

healthcheck 只验「备份文件在且新鲜」,不验「能否灌回」——大版本格式漂移、
编码/扩展缺失都可能让一份看着正常的备份灌不回去(已知风险)。唯一
能证明备份可恢复的凭据是定期演练。每季度一次,拿最近的备份走一遍完整恢复,
**灌进一次性测试库,切勿灌回生产**:

- [ ] 取最新 `insuredesk-<时间戳>.sql.gz`,`gunzip -t` 先验归档未损坏
- [ ] 按上节「从备份恢复」灌入一套临时库(可在另一台机或本地 `up` 一个
      db 容器),psql 全程 `ON_ERROR_STOP=1` 无报错
- [ ] 抽查关键表:工单数、最新工单时间与备份时刻预期一致
- [ ] 记录演练日期与所用备份文件名;演练即验证「文件在 → 可恢复」这一环

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
