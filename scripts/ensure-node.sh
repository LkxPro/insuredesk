# 保证当前 shell 跑在 .nvmrc 钉定的 node 版本上：版本在磁盘则 PATH 切换，
# 不在则 nvm 安装后切换，nvm 本身未装才硬报错（装 nvm 要改用户 shell 配置，
# 越出本脚本边界）。被 dev-up.sh / ci.sh source，不独立执行。
# 必须切对版本而非将就着跑：node_modules 里的原生二进制（esbuild、prisma
# engines）按安装时的 ABI 编译，版本错了会以难懂的方式炸。

ensure_node() {
  local nvm_dir="${NVM_DIR:-$HOME/.nvm}"
  local required="$(tr -d '[:space:]' < .nvmrc)"
  local current="$(node --version 2>/dev/null || true)"
  current="${current#v}"

  if [ "$current" != "$required" ]; then
    local version_bin="$nvm_dir/versions/node/v$required/bin"
    if [ ! -d "$version_bin" ]; then
      if [ ! -s "$nvm_dir/nvm.sh" ]; then
        echo "✗ 需要 node ${required}（.nvmrc），当前 ${current:-未安装 node}，且本机没有 nvm" >&2
        echo "  先装 nvm：https://github.com/nvm-sh/nvm" >&2
        return 1
      fi
      echo "→ nvm install ${required}（首次需下载）"
      # nvm 脚本按交互 shell 的假设编写，内部有未绑定变量引用和预期失败的命令，
      # source 期间必须放宽 -eu，事后按调用方原样恢复。
      local flags=$-
      set +eu
      . "$nvm_dir/nvm.sh"
      nvm install "$required"
      local rc=$?
      case $flags in *e*) set -e ;; esac
      case $flags in *u*) set -u ;; esac
      if [ $rc -ne 0 ]; then
        echo "✗ nvm install $required 失败" >&2
        return 1
      fi
    fi
    # 直接 prepend 版本目录而不走 nvm use：非交互 shell 里 nvm 函数未必可用，
    # 固定路径也不受用户 PATH 里其他 node（如 ~/.local/bin）遮蔽的影响。
    PATH="$version_bin:$PATH"
    export PATH
    echo "✓ 已切换 node ${current:-none} → $required"
  fi

  # corepack 首次下载 pnpm 默认要交互确认，自动化场景必须关掉。
  export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
  if ! command -v pnpm > /dev/null 2>&1; then
    echo "→ corepack enable（pnpm 不在 PATH）"
    if ! corepack enable; then
      echo "✗ corepack enable 失败" >&2
      return 1
    fi
  fi

  echo "✓ node $(node --version | tr -d 'v') · pnpm $(pnpm --version)"
}

ensure_node
