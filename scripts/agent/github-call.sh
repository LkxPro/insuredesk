#!/bin/sh
set -eu

timeout=${AGENT_PUBLISH_REQUEST_TIMEOUT_SECONDS:-120}
case $timeout in *[!0-9]*|'') echo 'GitHub request timeout must be a positive integer' >&2; exit 64;; esac
[ "$timeout" -gt 0 ] || { echo 'GitHub request timeout must be a positive integer' >&2; exit 64; }

input_file=''
previous=''
for argument in "$@"; do
  if [ "$previous" = --input ] && [ "$argument" = - ]; then
    input_file=$(mktemp)
    cat >"$input_file"
    break
  fi
  previous=$argument
done
cleanup() {
  [ -z "$input_file" ] || rm -f "$input_file"
}
trap cleanup EXIT HUP INT TERM

if [ -n "$input_file" ]; then
  "$@" <"$input_file" & command_pid=$!
else
  "$@" </dev/null & command_pid=$!
fi
(
  sleeper=''
  stop_watchdog() {
    [ -z "$sleeper" ] || kill "$sleeper" 2>/dev/null || true
    exit 0
  }
  trap stop_watchdog HUP INT TERM
  sleep "$timeout" & sleeper=$!
  wait "$sleeper" || exit 0
  descendants=$(pgrep -P "$command_pid" 2>/dev/null || true)
  for descendant in $descendants; do
    pkill -TERM -P "$descendant" 2>/dev/null || true
    kill -TERM "$descendant" 2>/dev/null || true
  done
  kill -TERM "$command_pid" 2>/dev/null || true
  sleep 2
  pkill -KILL -P "$command_pid" 2>/dev/null || true
  kill -KILL "$command_pid" 2>/dev/null || true
) & watchdog=$!

status=0
wait "$command_pid" || status=$?
kill "$watchdog" 2>/dev/null || true
wait "$watchdog" 2>/dev/null || true
exit "$status"
