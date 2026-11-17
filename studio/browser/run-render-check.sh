#!/usr/bin/env bash
# Studio-only: real-browser check of every page at desktop, 390px and 320px.
# Reports console errors, page exceptions, horizontal overflow, Testnet text and
# page height. Screenshots go to /tmp/shots. Requires setup-browser.sh and a
# running Preview on :5173.
set -euo pipefail
export LD_LIBRARY_PATH=/tmp/chromelibs/usr/lib/x86_64-linux-gnu FONTCONFIG_FILE=/tmp/fonts.conf
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
curl -fsS -m 10 -o /dev/null http://localhost:5173/ || { echo "Preview is not running on :5173 (bun run dev)" >&2; exit 1; }
node "$DIR/render-check.mjs"
