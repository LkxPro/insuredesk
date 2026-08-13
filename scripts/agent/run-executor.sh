#!/bin/sh
set -eu

repo=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)

if [ -n "${AGENT_EXECUTOR_ADAPTER:-}" ]; then
  adapter=$AGENT_EXECUTOR_ADAPTER
else
  executor=${AGENT_EXECUTOR:-claude}
  case $executor in
    *[!a-zA-Z0-9_-]*)
      echo "agent executor name contains unsupported characters: $executor" >&2
      exit 64
      ;;
  esac
  adapter="$repo/scripts/agent/executors/$executor.sh"
fi

if [ ! -x "$adapter" ]; then
  echo "agent executor adapter is not executable: $adapter" >&2
  exit 69
fi

exec "$adapter"
