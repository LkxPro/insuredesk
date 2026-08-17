#!/bin/sh
set -eu

timeout=${AGENT_PUBLISH_REQUEST_TIMEOUT_SECONDS:-120}
case $timeout in *[!0-9]*|'') echo 'GitHub request timeout must be a positive integer' >&2; exit 64;; esac
[ "$timeout" -gt 0 ] || { echo 'GitHub request timeout must be a positive integer' >&2; exit 64; }

command=${1:?github-call.sh: command required}
shift
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
AGENT_LOOP_GH=$command exec node "$script_dir/net-cli.ts" --timeout-seconds "$timeout" -- "$@"
