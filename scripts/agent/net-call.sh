#!/bin/sh
# 网络调用统一入口：单次尝试带看门狗超时；stderr 命中传输层特征（connection
# reset、TLS、5xx 等）时指数退避重试。确定性错误（lease 拒绝、4xx 校验）不
# 命中特征，首次失败即原样返回。stdout 只在成功时放行，避免半截输出污染
# 调用方的 JSON 解析。
set -eu

attempts=${AGENT_NET_CALL_ATTEMPTS:-4}
case $attempts in *[!0-9]*|'') attempts=4 ;; esac
[ "$attempts" -gt 0 ] || attempts=4
delay=${AGENT_NET_CALL_BASE_DELAY:-2}
case $delay in *[!0-9]*|'') delay=2 ;; esac
timeout=${AGENT_NET_CALL_TIMEOUT_SECONDS:-30}
case $timeout in *[!0-9]*|'') timeout=30 ;; esac
[ "$timeout" -gt 0 ] || timeout=30

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
out_file=$(mktemp)
err_file=$(mktemp)
cleanup() {
  rm -f "$out_file" "$err_file"
}
trap cleanup EXIT HUP INT TERM

is_transient() {
  grep -Eiq 'connection (reset|refused|closed|aborted)|operation timed out|i/o timeout|timed out|could not resolve host|temporary failure in name resolution|no route to host|network (is )?unreachable|tls handshake timeout|context deadline exceeded|unexpected eof|eof$|gnutls recv error|http 5[0-9][0-9]|returned error: 5[0-9][0-9]|rate limit' "$err_file"
}

attempt=0
while :; do
  attempt=$((attempt + 1))
  : >"$out_file"
  : >"$err_file"
  status=0
  AGENT_PUBLISH_REQUEST_TIMEOUT_SECONDS=$timeout \
    sh "$script_dir/github-call.sh" "$@" >"$out_file" 2>"$err_file" || status=$?
  if [ "$status" -eq 0 ]; then
    cat "$out_file"
    cat "$err_file" >&2
    exit 0
  fi
  cat "$err_file" >&2
  [ "$attempt" -lt "$attempts" ] || exit "$status"
  # 看门狗杀死（124/137/143）时 stderr 可能为空，一律按 transient 处理。
  case $status in
    124|137|143) ;;
    *) is_transient || exit "$status" ;;
  esac
  echo "net-call: attempt $attempt failed (transient); retrying in ${delay}s" >&2
  sleep "$delay"
  delay=$((delay * 2))
done
