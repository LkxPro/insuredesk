#!/bin/sh
set -eu

namespace=${1:?lock namespace required}
key=${2:?lock key required}
lock_file=${3:?lock file required}
owner=${4:?owner pid required}
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
interval=${AGENT_PUBLISH_HEARTBEAT_INTERVAL:-30}
sleeper=''
stop_guard() {
  [ -z "$sleeper" ] || kill "$sleeper" 2>/dev/null || true
  exit 0
}
trap stop_guard HUP INT TERM

while kill -0 "$owner" 2>/dev/null; do
  sleep "$interval" & sleeper=$!
  wait "$sleeper" || exit 0
  sleeper=''
  kill -0 "$owner" 2>/dev/null || exit 0
  if ! sh "$script_dir/publication-lock.sh" heartbeat "$namespace" "$key" "$lock_file"; then
    descendants=$(pgrep -P "$owner" 2>/dev/null || true)
    for descendant in $descendants; do
      [ "$descendant" != "$$" ] || continue
      pkill -TERM -P "$descendant" 2>/dev/null || true
      kill -TERM "$descendant" 2>/dev/null || true
    done
    kill -TERM "$owner" 2>/dev/null || true
    sleep 2
    descendants=$(pgrep -P "$owner" 2>/dev/null || true)
    for descendant in $descendants; do
      [ "$descendant" != "$$" ] || continue
      pkill -KILL -P "$descendant" 2>/dev/null || true
      kill -KILL "$descendant" 2>/dev/null || true
    done
    kill -KILL "$owner" 2>/dev/null || true
    exit 1
  fi
done
