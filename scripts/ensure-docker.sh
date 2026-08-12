# docker daemon 未运行时拉起 OrbStack（本仓库开发机的 docker 运行时），60s 内
# 未就绪则硬报错。没有 OrbStack 就直接报错让用户自己起——不探测别家运行时，
# docker 接口本身是统一的。被 dev-up.sh source，不独立执行。

ensure_docker() {
  if docker info > /dev/null 2>&1; then
    return 0
  fi
  if [ -d /Applications/OrbStack.app ]; then
    echo "→ docker daemon 未运行，启动 OrbStack"
    # -g 不抢焦点，只是拉起服务。
    open -ga OrbStack
    local i=0
    while [ $i -lt 30 ]; do
      docker info > /dev/null 2>&1 && break
      sleep 2
      i=$((i + 1))
    done
  fi
  if ! docker info > /dev/null 2>&1; then
    echo "✗ docker 不可用。安装并启动 docker 运行时（如 OrbStack）后重试。" >&2
    return 1
  fi
}

ensure_docker
