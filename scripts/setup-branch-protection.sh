#!/bin/bash
# 启用 main 分支保护（ADR 0009）：禁直推、全部 CI check 绿才能合入。
# 一次性脚本，由仓库管理员在本机执行（需要 gh 已登录且对仓库有 admin 权限）：
#
#   ./scripts/setup-branch-protection.sh
#
# 配置说明：
# - required checks 为 ci.yml 的两个 job id（lint-and-test、docker-build），
#   改 job 名时须同步重跑本脚本。
# - required_approving_review_count=0：必须走 PR 但不要求他人 approve——
#   单人仓库要求 approve 会把自己锁死（GitHub 不允许 approve 自己的 PR）。
# - enforce_admins=true：管理员同样禁止直推，否则对单人仓库形同虚设。
# - strict=false：不要求 PR 分支与 main 同步后才能合入——Dependabot 按周
#   成批开 PR，strict 会让每合一个就得刷新其余全部。
set -euo pipefail

REPO="${1:-LkxPro/insuredesk}"

gh api -X PUT "repos/${REPO}/branches/main/protection" --input - <<'JSON'
{
  "required_status_checks": {
    "strict": false,
    "contexts": ["lint-and-test", "docker-build"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 0
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON

echo "Branch protection enabled on ${REPO}@main:"
gh api "repos/${REPO}/branches/main/protection" \
  --jq '{checks: .required_status_checks.contexts, enforce_admins: .enforce_admins.enabled, pr_required: (.required_pull_request_reviews != null)}'
