#!/usr/bin/env bash
# Guarded production build for the Studio sandbox.
#
# A full Veyra production build needs roughly 2 GB for the Rollup render phase
# plus the memory the Preview server already holds. In a 3.9 GB sandbox this
# gets OOM-killed, and the kernel can take the Preview's esbuild helper with
# it. Vercel builds Production; this wrapper refuses to start a build that is
# likely to fail instead of failing halfway and breaking the Preview.
#
#   STUDIO_ALLOW_BUILD=1 bun run build    # override after stopping the Preview
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
avail_mb="$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)"
need_mb="${STUDIO_BUILD_MIN_MB:-3000}"

if [ "${STUDIO_ALLOW_BUILD:-0}" != "1" ] && [ "$avail_mb" -lt "$need_mb" ]; then
  cat >&2 <<EOF
[studio] Refusing to start a production build: ${avail_mb} MB available, ${need_mb} MB needed.

Vercel builds Production from GitHub. To build here anyway, stop the Preview
dev server first and run:  STUDIO_ALLOW_BUILD=1 bun run build
Checks that fit in memory:  bun run typecheck && bun run lint && bun run test
EOF
  exit 1
fi
exec bun run --cwd "$REPO" build "$@"
