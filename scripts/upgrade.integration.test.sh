#!/bin/sh
set -eu

repo="$(cd "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT INT TERM
fakebin="$tmp/bin"
mkdir -p "$fakebin"

cp "$repo/scripts/upgrade.sh" "$tmp/upgrade.sh"
cp "$repo/docker-compose.prod.yml" "$tmp/docker-compose.prod.yml"

cat >"$fakebin/git" <<'EOF'
#!/bin/sh
case "$1 $2" in
  "rev-parse --show-toplevel") printf '%s\n' "$FAKE_ROOT" ;;
  "ls-remote --tags") printf 'aaa\trefs/tags/v2026.08.0\n' ;;
  *) exit 2 ;;
esac
EOF

cat >"$fakebin/docker" <<'EOF'
#!/bin/sh
log="$FAKE_ROOT/calls"
printf '%s\n' "$*" >>"$log"

if [ "$1" = compose ]; then
  shift 3
  case "$1" in
    config) printf 'postgres:17-alpine\nghcr.io/lkxpro/insuredesk-api:v2026.08.0\n' ;;
    ps) printf 'api-container\n' ;;
    pull) [ "${FAIL_PULL:-0}" = 1 ] && exit 42 ;;
    run)
      if [ "$4" = backup ]; then
        printf 'backup ok: /backups/fixture.sql.gz (1M)\n'
      fi
      ;;
    up)
      [ "${FAIL_UP:-0}" = 1 ] && exit 43
      printf 'ghcr.io/lkxpro/insuredesk-api:v2026.08.0\n' >"$FAKE_ROOT/running-image"
      printf 'true\n' >"$FAKE_ROOT/running"
      ;;
    logs) : ;;
    *) exit 2 ;;
  esac
  exit 0
fi

if [ "$1" = inspect ]; then
  case "$3" in
    *Config.Image*) cat "$FAKE_ROOT/running-image" ;;
    *State.Running*) cat "$FAKE_ROOT/running" ;;
    *) exit 2 ;;
  esac
  exit 0
fi
exit 2
EOF

cat >"$fakebin/curl" <<'EOF'
#!/bin/sh
[ "$(cat "$FAKE_ROOT/ready")" = true ]
EOF

cat >"$fakebin/sleep" <<'EOF'
#!/bin/sh
:
EOF

chmod +x "$fakebin/git" "$fakebin/docker" "$fakebin/curl" "$fakebin/sleep"

reset_fixture() {
  configured="$1"
  running="$2"
  printf 'IMAGE_TAG="%s"\nSECRET=fixture\n' "$configured" >"$tmp/.env"
  chmod 640 "$tmp/.env"
  printf '%s\n' "$running" >"$tmp/running-image"
  printf 'true\n' >"$tmp/running"
  printf 'true\n' >"$tmp/ready"
  : >"$tmp/calls"
}

run_upgrade() {
  env PATH="$fakebin:$PATH" FAKE_ROOT="$tmp" ENV_FILE="$tmp/.env" \
    WAIT_ATTEMPTS=1 WAIT_INTERVAL=0 "$tmp/upgrade.sh"
}

assert_tag() {
  grep -qx "IMAGE_TAG=\"$1\"" "$tmp/.env"
}

assert_no_call() {
  if grep -q "$1" "$tmp/calls"; then
    echo "unexpected call matching '$1'" >&2
    exit 1
  fi
}

reset_fixture v2026.08.0 ghcr.io/lkxpro/insuredesk-api:v2026.07.11
run_upgrade >/dev/null
assert_tag v2026.08.0
grep -q 'compose -f docker-compose.prod.yml pull insuredesk-api-prod' "$tmp/calls"
grep -q 'compose -f docker-compose.prod.yml up -d --no-deps insuredesk-api-prod' "$tmp/calls"
echo 'ok   - configured latest but running old resumes upgrade'

reset_fixture v2026.07.11 ghcr.io/lkxpro/insuredesk-api:v2026.07.11
if FAIL_PULL=1 run_upgrade >/dev/null 2>&1; then
  echo 'pull failure unexpectedly succeeded' >&2
  exit 1
fi
assert_tag v2026.07.11
assert_no_call 'run --rm -T backup once'
assert_no_call 'up -d'
echo 'ok   - pull failure preserves config and skips backup/switch'

reset_fixture v2026.07.11 ghcr.io/lkxpro/insuredesk-api:v2026.07.11
if FAIL_UP=1 run_upgrade >/dev/null 2>&1; then
  echo 'up failure unexpectedly succeeded' >&2
  exit 1
fi
assert_tag v2026.07.11
echo 'ok   - up failure preserves configured version'

reset_fixture v2026.07.11 ghcr.io/lkxpro/insuredesk-api:v2026.08.0
run_upgrade >/dev/null
assert_tag v2026.08.0
assert_no_call 'pull insuredesk-api-prod'
assert_no_call 'run --rm -T backup once'
[ "$(stat -c %a "$tmp/.env" 2>/dev/null || stat -f %Lp "$tmp/.env")" = 600 ]
echo 'ok   - running latest repairs stale config without redeploy'

echo PASS
