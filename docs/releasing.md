# 发版

发布与部署策略见 ADR 0009。本文是操作手册:发版流水线(Release workflow +
钉版本 compose)已实施,生产更新按本文执行;末尾待实施清单的剩余项为治理
增强,不阻塞发版。

## 版本号

CalVer:`v<年>.<月>.<序号>`,如 `v2026.07.0`;同月第二次发布为
`v2026.07.1`。git tag 是唯一版本事实,`package.json` 保持 `0.0.0`。

## 发一个版本

1. 确认 main 上要发布的内容已全部合入且 CI 绿。
2. GitHub → Actions → Release workflow → Run workflow(在 main 上)。workflow
   自动:
   - 算出下一个 CalVer 号;
   - 构建 api 生产镜像推送 `ghcr.io/lkxpro/insuredesk-api:<tag>`(先推镜像
     后打 tag,构建失败不会留下无镜像的版本号,修复后重跑即可);
   - 打 tag 并创建 GitHub Release,notes 按 PR 自动生成
     (`.github/release.yml` 按 label 分组)。
3. 若本次升级需要新环境变量或含数据迁移,在 Release notes 顶部手动补一段
   部署注意事项。

## 升级服务器

```bash
# 升级前固定动作:手动备份一次
docker exec insuredesk-db-prod pg_dump -U insuredesk insuredesk | gzip > ~/backups/pre-$TAG.sql.gz

# 钉新版本并拉起
sed -i 's/^IMAGE_TAG=.*/IMAGE_TAG=v2026.07.1/' .env
docker compose -f docker-compose.prod.yml pull api   # 私有镜像,需先 docker login ghcr.io
docker compose -f docker-compose.prod.yml up -d
```

GHCR 拉不动(受限网络)时走退路:`git fetch --tags && git checkout <tag>`
后 `up -d --build`,产物与镜像同源。

## 回滚

**只前滚**(ADR 0009):

- 新版容器起不来、迁移未执行 → 把 `IMAGE_TAG` 改回上一个 tag,`up -d`。
- 迁移已执行后发现问题 → 修复后走正常发版流程发 hotfix 版,不向后退。
- 灾难性故障 → 停服,用备份恢复数据库,钉备份时刻对应的 tag 起服务
  (丢失备份之后的数据)。

## 备份

宿主机 cron 每日 `pg_dump` 到本机备份目录,保留 14 天。**已知风险:无异地
副本,机器级故障 = 数据全失**(ADR 0009 明确接受)。

## 待实施清单

发版体系逐项实施(每项可独立开 issue),剩余未勾项为治理增强:

- [x] 迁移 squash 成基线——最后一次行使"可改写历史迁移"约定,此后
      append-only(ADR 0009)
- [x] Release workflow(`workflow_dispatch`:算号、打 tag、建 Release、
      构建推送镜像)+ `.github/release.yml` notes 分组
- [x] `docker-compose.prod.yml` 改造:`image: …:${IMAGE_TAG}` + `build:`
      退路;`.env.example` 增补 `IMAGE_TAG`;同步更新 `docs/deployment.md`
      的更新/回滚章节与 GHCR 登录说明
- [ ] 备份 cron 脚本与保留策略,写入部署文档
- [ ] main 分支保护(禁直推、要求 CI 通过)
- [ ] CI 增加生产 Dockerfile 构建校验(只构建不推送)
- [ ] 启用 Dependabot(npm + GitHub Actions,按周分组)
