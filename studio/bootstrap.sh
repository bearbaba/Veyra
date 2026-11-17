#!/usr/bin/env bash
# One command that makes an Arc Studio workspace reproducible from GitHub.
#
#   git clone https://github.com/bearbaba/Veyra.git Veyra-github   # inside the workspace root
#   bash Veyra-github/studio/bootstrap.sh [--install]
#
#   --install   also run `bun install --frozen-lockfile` in the repository
#   --verify    only check that no root script can run the old snapshot
#
# Idempotent. See studio/README.md.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$REPO/.." && pwd)"
mode="apply"; install=0
for arg in "$@"; do
  case "$arg" in
    --verify) mode="verify" ;;
    --install) install=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

[ -f "$ROOT/package.json" ] || { echo "[studio] $ROOT has no package.json; run this from a Studio workspace." >&2; exit 1; }

if [ "$mode" = "verify" ]; then
  exec bun run "$REPO/studio/bootstrap-root.ts" "$ROOT" "$REPO" --verify
fi

bun run "$REPO/studio/bootstrap-root.ts" "$ROOT" "$REPO"
chmod +x "$REPO"/studio/*.sh
if [ "$install" = "1" ] || [ ! -x "$REPO/node_modules/.bin/vite" ]; then
  echo "[studio] installing repository dependencies (frozen lockfile)"
  bun install --frozen-lockfile --cwd "$REPO"
fi
bun run "$REPO/studio/bootstrap-root.ts" "$ROOT" "$REPO" --verify
echo "[studio] ready. Preview: bun run dev   Backend: bun run server   Checks: bun run check"
