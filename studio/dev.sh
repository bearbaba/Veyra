#!/usr/bin/env bash
# Arc Studio Preview launcher. Environment tooling only: nothing in the Veyra
# application imports or depends on anything under studio/.
#
# Studio runs `bun run dev` in the workspace root. studio/bootstrap.sh points
# that script here, so the default Preview always serves THIS repository with
# the same Mainnet profile the Vercel Production build uses.
#
# Safety properties
#   - One Vite process (exec) and --strictPort, so a second server cannot start.
#   - esbuild's Go heap is capped (GOMEMLIMIT/GOGC). Uncapped it grows to ~2 GB
#     in a 3.9 GB sandbox and is OOM-killed; Vite never restarts it and then
#     answers every uncached file with "The service is no longer running".
#   - Dev mode never sets VERCEL_ENV=production, so Mainnet signing stays
#     disabled in the Preview.
#   - /api is proxied to http://localhost:3001 only (see vite.config.ts) and the
#     Mainnet identity backend accepts only the official production origin, so a
#     Preview cannot reach live identity or payment routes.
#   - The Mainnet profile is read from scripts/build-mainnet-pilot.ts so Preview
#     and Production cannot drift apart.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE="$REPO/scripts/build-mainnet-pilot.ts"

if [ ! -x "$REPO/node_modules/.bin/vite" ]; then
  echo "[studio] Dependencies are missing. Run: bun install --frozen-lockfile --cwd \"$REPO\"" >&2
  exit 1
fi
if [ ! -f "$PROFILE" ]; then
  echo "[studio] $PROFILE not found; refusing to guess a build profile." >&2
  exit 1
fi

# KEY:'value' pairs from the repo profile -> exported KEY=value
while IFS= read -r pair; do
  export "$pair"
done < <(grep -oE "VITE_[A-Z0-9_]+:'[^']*'" "$PROFILE" | sed -E "s/:'([^']*)'/=\1/")
if [ "${VITE_VEYRA_ENV:-}" != "mainnet" ]; then
  echo "[studio] Mainnet profile could not be read from $PROFILE (VITE_VEYRA_ENV='${VITE_VEYRA_ENV:-}')." >&2
  exit 1
fi

export GOMEMLIMIT="${GOMEMLIMIT:-700MiB}"
export GOGC="${GOGC:-50}"

branch="$(git -C "$REPO" branch --show-current 2>/dev/null || echo '?')"
commit="$(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo '?')"
echo "[studio] Serving $REPO @ $branch ($commit) as VITE_VEYRA_ENV=$VITE_VEYRA_ENV; esbuild heap capped at $GOMEMLIMIT"

if [ "$#" -eq 0 ]; then
  set -- --host 0.0.0.0 --port 5173 --strictPort
fi
exec bun run --cwd "$REPO" dev "$@"
