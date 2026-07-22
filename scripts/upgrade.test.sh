#!/bin/sh
# resolve_latest_tag 的排序口径必须与发版 workflow (.github/workflows/release.yml)
# 一致，否则「最新」两处打架：workflow 按序号数值升序取末位，这里把同一口径扩到
# 年.月.序号三段全数值比较。跑法：`sh scripts/upgrade.test.sh`。
set -eu

here="$(cd "$(dirname "$0")" && pwd)"
# 只取函数、不跑 main。
# shellcheck source=scripts/upgrade.sh
UPGRADE_LIB=1 . "$here/upgrade.sh"

fails=0
check() {
  # check <名称> <期望> <ls-remote 样本>
  got="$(printf '%s' "$3" | resolve_latest_tag)"
  if [ "$got" = "$2" ]; then
    echo "ok   - $1"
  else
    echo "FAIL - $1: expected '$2', got '$got'"
    fails=$((fails + 1))
  fi
}

# 序号按数值比，不按字典序：v2026.07.10 > v2026.07.9（字典序会判反）。
check "numeric seq, not lexical" "v2026.07.10" \
'aaa	refs/tags/v2026.07.9
bbb	refs/tags/v2026.07.10'

# 跨月、跨年同样数值比较。
check "cross-month" "v2026.08.0" \
'aaa	refs/tags/v2026.07.10
bbb	refs/tags/v2026.08.0'

check "cross-year" "v2026.01.0" \
'aaa	refs/tags/v2025.12.5
bbb	refs/tags/v2026.01.0'

# 注释标签的 ^{} 解引用行不是版本、不能参与比较（否则重复计数或误判）。
check "ignores ^{} deref lines" "v2026.07.3" \
'aaa	refs/tags/v2026.07.3
aaa	refs/tags/v2026.07.3^{}'

# 非 CalVer 的 tag / 分支 ref 一律滤掉。
check "filters junk tags" "v2026.07.0" \
'aaa	refs/tags/v2026.07.0
bbb	refs/tags/vfoo
ccc	refs/tags/v1.2
ddd	refs/tags/latest
eee	refs/heads/main'

# 无 tag、或全是垃圾 → 空（调用方据此判定「没有可升级的版本」）。
check "empty input -> empty" "" ""
check "only junk -> empty" "" \
'aaa	refs/tags/latest
bbb	refs/heads/main'

if [ "$fails" -eq 0 ]; then
  echo "PASS"
else
  echo "$fails test(s) failed" >&2
  exit 1
fi
