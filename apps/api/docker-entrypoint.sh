#!/bin/sh
# Production container startup chain: a failed migration fails the container
# (fail fast; check `docker logs`). Both steps are idempotent, so every
# restart runs them unconditionally. `exec` keeps the server as PID 1's
# direct child so SIGTERM from `docker stop` reaches it.
set -e
pnpm exec prisma migrate deploy
pnpm exec tsx prisma/bootstrap.ts
exec pnpm start
