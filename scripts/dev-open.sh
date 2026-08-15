#!/bin/sh
set -eu

cd "$(git rev-parse --show-toplevel)"

port=$(sh scripts/dev-ports.sh --web-port 2>/dev/null)

if ! lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "✗ 端口 $port 未在监听——先 make dev" >&2
  exit 1
fi

open "http://127.0.0.1:$port/"
