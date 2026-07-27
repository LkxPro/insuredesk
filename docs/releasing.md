# 发版

本文是发版与升级的操作手册:发版流水线(Release workflow + 钉版本 compose)
已实施,生产更新按本文执行;末尾待实施清单的剩余项为治理增强,不阻塞发版。

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
make upgrade
```

一条命令干完:脚本用 `git ls-remote --tags` 解析出最新 CalVer
(与上文「发一个版本」的算号口径一致),当前已是最新则直接退出、无副作用;
有新版则**迁前备份 → 校验 dump 非空 → 把 `.env` 的 `IMAGE_TAG` 写成那个具体
tag → `pull` → `up -d`**。操作员不手敲版本号,但服务器 `.env` 始终钉着确定的
tag,回滚有明确目标。备份是脚本第一步、迁移随容器启动执行,故迁前备份天然
早于迁移。私有镜像需先 `docker login ghcr.io`(见 `docs/deployment.md`)。

`make upgrade` 是唯一 sanctioned 升级路径。手改 `.env` 的 `IMAGE_TAG` 后直接
`up -d` 会让迁移在无备份下执行,操作员自负(已知风险)。GHCR 拉不动
(受限网络)时走退路:`git fetch --tags && git checkout <tag>` 后
`up -d --build`,产物与镜像同源。

## 回滚

**只前滚**:

- 新版容器起不来、迁移未执行 → 把 `IMAGE_TAG` 改回上一个 tag,`up -d`。
- 迁移已执行后发现问题 → 修复后走正常发版流程发 hotfix 版,不向后退。
- 灾难性故障 → 停服,用备份恢复数据库,钉备份时刻对应的 tag 起服务
  (丢失备份之后的数据)。

## 备份

backup sidecar 每日在容器内 `pg_dump` 到宿主机备份目录,保留 14 天(不再依赖
宿主机 cron)。sidecar 说明、验证、手动备份与恢复步骤见 `docs/deployment.md`
→ 备份与恢复。**已知风险:无异地副本,机器级故障 = 数据全失**(已明确
接受)。

## 待实施清单

发版体系逐项实施(每项可独立开 issue),剩余未勾项为治理增强:

- [x] Release workflow(`workflow_dispatch`:算号、打 tag、建 Release、
      构建推送镜像)+ `.github/release.yml` notes 分组
- [x] `docker-compose.prod.yml` 改造:`image: …:${IMAGE_TAG}` + `build:`
      退路;`.env.example` 增补 `IMAGE_TAG`;同步更新 `docs/deployment.md`
      的更新/回滚章节与 GHCR 登录说明
- [x] 备份 cron 脚本与保留策略,写入部署文档
- [x] `make upgrade` 一键升级(解析最新 CalVer → 迁前备份 → 钉版本 →
      `pull` + `up -d`),升级/更新章节改为一条命令
- [x] CI 增加生产 Dockerfile 构建校验(只构建不推送)
- [x] 启用 Dependabot(npm + GitHub Actions,按周分组)
