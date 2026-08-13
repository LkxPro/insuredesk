#!/bin/sh
set -eu

action=${1:?action required}
namespace=${2:?lock namespace required}
key=${3:?lock key required}
lock_file=${4:?lock file required}
git_dir=${AGENT_PUBLISH_GIT_DIR:-$(git rev-parse --show-toplevel)}
ref="refs/heads/agent-publish-locks/$namespace-$key"

case $namespace in *[!a-zA-Z0-9_-]*) echo 'publication lock namespace contains unsupported characters' >&2; exit 64;; esac
case $key in *[!a-zA-Z0-9_-]*) echo 'publication lock key contains unsupported characters' >&2; exit 64;; esac

release() {
  [ -f "$lock_file" ] || return 0
  expected=$(sed -n '2p' "$lock_file")
  current=$(git -C "$git_dir" ls-remote origin "$ref" | awk 'NR == 1 {print $1}')
  if [ -n "$current" ] && [ "$current" = "$expected" ]; then
    git -C "$git_dir" push --force-with-lease="$ref:$expected" origin ":$ref" >/dev/null 2>&1
  fi
  rm -f "$lock_file"
}

lock_operation() {
  operation_lock="$lock_file.operation"
  while ! mkdir "$operation_lock" 2>/dev/null; do sleep 1; done
}

unlock_operation() {
  rmdir "$operation_lock" 2>/dev/null || true
}

acquire() {
  wait_seconds=${AGENT_PUBLISH_LOCK_WAIT_SECONDS:-30}
  stale_seconds=${AGENT_PUBLISH_LOCK_STALE_SECONDS:-300}
  heartbeat_interval=${AGENT_PUBLISH_HEARTBEAT_INTERVAL:-30}
  request_timeout=${AGENT_PUBLISH_REQUEST_TIMEOUT_SECONDS:-120}
  case $wait_seconds:$stale_seconds:$heartbeat_interval:$request_timeout in
    *[!0-9:]*) echo 'publication lock timeouts must be non-negative integers' >&2; exit 64 ;;
  esac
  [ "$heartbeat_interval" -gt 0 ] && [ "$request_timeout" -gt 0 ] && \
    [ $((request_timeout + heartbeat_interval * 2)) -lt "$stale_seconds" ] || {
      echo 'publication request timeout plus two heartbeat intervals must be below stale timeout' >&2
      exit 64
    }
  base=$(git -C "$git_dir" rev-parse origin/main)
  deadline=$(($(date +%s) + wait_seconds))
  while :; do
    current=$(git -C "$git_dir" ls-remote origin "$ref" | awk 'NR == 1 {print $1}')
    if [ -z "$current" ]; then
      claim=$(git -C "$git_dir" -c user.name=insuredesk-agent-publisher \
        -c user.email=insuredesk-agent-publisher@users.noreply.github.com \
        commit-tree "$base^{tree}" -p "$base" -m "publish lock $namespace $key by $$")
      if git -C "$git_dir" push --force-with-lease="$ref:" origin "$claim:$ref" >/dev/null 2>&1; then
        printf '%s\n%s\n' "$ref" "$claim" >"$lock_file"
        return 0
      fi
    else
      git -C "$git_dir" fetch -q origin "$ref"
      observed=$(git -C "$git_dir" rev-parse FETCH_HEAD)
      claimed_at=$(git -C "$git_dir" log -1 --format=%ct FETCH_HEAD)
      now=$(date +%s)
      if [ "$observed" = "$current" ] && [ $((now - claimed_at)) -ge "$stale_seconds" ]; then
        git -C "$git_dir" push --force-with-lease="$ref:$observed" origin ":$ref" >/dev/null 2>&1 || true
        continue
      fi
    fi
    [ "$(date +%s)" -lt "$deadline" ] || { echo "publication lock busy: $namespace/$key" >&2; return 75; }
    sleep 1
  done
}

heartbeat() {
  lock_operation
  trap unlock_operation EXIT HUP INT TERM
  [ -f "$lock_file" ] || return 1
  expected=$(sed -n '2p' "$lock_file")
  current=$(git -C "$git_dir" ls-remote origin "$ref" | awk 'NR == 1 {print $1}')
  [ -n "$expected" ] && [ "$current" = "$expected" ] || return 1
  refreshed=$(git -C "$git_dir" -c user.name=insuredesk-agent-publisher \
    -c user.email=insuredesk-agent-publisher@users.noreply.github.com \
    commit-tree "$expected^{tree}" -p "$expected" -m "publish lock $namespace $key by $$")
  git -C "$git_dir" push --force-with-lease="$ref:$expected" origin "$refreshed:$ref" >/dev/null 2>&1
  printf '%s\n%s\n' "$ref" "$refreshed" >"$lock_file.next"
  mv "$lock_file.next" "$lock_file"
}

verify() {
  lock_operation
  trap unlock_operation EXIT HUP INT TERM
  [ -f "$lock_file" ] || return 1
  expected=$(sed -n '2p' "$lock_file")
  current=$(git -C "$git_dir" ls-remote origin "$ref" | awk 'NR == 1 {print $1}')
  [ -n "$expected" ] && [ "$current" = "$expected" ]
}

case $action in
  acquire) acquire ;;
  heartbeat) heartbeat ;;
  verify) verify ;;
  release) release ;;
  *) echo 'usage: publication-lock.sh {acquire|heartbeat|verify|release} namespace key lock-file' >&2; exit 64 ;;
esac
