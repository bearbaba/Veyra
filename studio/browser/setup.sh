#!/usr/bin/env bash
# Studio-only: make headless Chromium usable in this sandbox so UI changes can be
# verified in a real browser. Not part of the Veyra application or repository.
#
# The sandbox has no sudo, no system fonts and none of Chromium's shared
# libraries. This downloads the Debian packages without root, unpacks them under
# /tmp and writes a minimal fontconfig. It is idempotent and safe to re-run.
#
# After it finishes, run checks with:
#   bash studio/browser/run-render-check.sh
set -euo pipefail

HARNESS=/tmp/veyra-browser
LIBS=/tmp/chromelibs
DEBS=/tmp/chromedebs
FONTS=/tmp/chromefonts
mkdir -p "$HARNESS" "$LIBS" "$DEBS" "$FONTS" /tmp/fccache /tmp/shots

# 1. Pinned Playwright (same major used by the repository's CI), outside the repo.
if [ ! -d "$HARNESS/node_modules/playwright" ]; then
  [ -f "$HARNESS/package.json" ] || echo '{"name":"veyra-browser-harness","private":true}' > "$HARNESS/package.json"
  bun add --cwd "$HARNESS" playwright@1.55.0
fi
CHROME="$(find "$HOME/.cache/ms-playwright" -maxdepth 3 -type f -name chrome -path '*chromium-*' 2>/dev/null | head -1 || true)"
if [ -z "$CHROME" ]; then
  node "$HARNESS/node_modules/playwright/cli.js" install chromium || true   # warns about host libs; handled below
  CHROME="$(find "$HOME/.cache/ms-playwright" -maxdepth 3 -type f -name chrome -path '*chromium-*' | head -1)"
fi

# 2. Shared libraries, unpacked without root (Debian 13 package names).
PKGS="libx11-6 libxcomposite1 libxdamage1 libxext6 libxfixes3 libxrandr2 libasound2t64 libatk1.0-0t64
 libatk-bridge2.0-0t64 libatspi2.0-0t64 libcairo2 libcups2t64 libgbm1 libglib2.0-0t64 libnspr4 libnss3
 libpango-1.0-0 libxcb1 libxkbcommon0 libxau6 libxdmcp6 libxi6 libxrender1 libatomic1 libavahi-client3
 libavahi-common3 libdrm2 libfontconfig1 libfreetype6 libfribidi0 libharfbuzz0b libpixman-1-0
 libpng16-16t64 libthai0 libxcb-render0 libxcb-shm0 libdatrie1 libgraphite2-3 fonts-dejavu-core"
if [ ! -f "$LIBS/.complete" ]; then
  ( cd "$DEBS"
    for p in $PKGS; do apt-get download "$p" >/dev/null 2>&1 || echo "[setup] could not download $p" >&2; done
    for d in ./*.deb; do dpkg -x "$d" "$LIBS"; done )
  cp "$LIBS"/usr/share/fonts/truetype/dejavu/*.ttf "$FONTS"/ 2>/dev/null || true
  touch "$LIBS/.complete"
fi
cat > /tmp/fonts.conf <<EOF
<?xml version="1.0"?>
<fontconfig><dir>$FONTS</dir><cachedir>/tmp/fccache</cachedir></fontconfig>
EOF

# 3. Verify nothing is still missing.
missing="$(LD_LIBRARY_PATH="$LIBS/usr/lib/x86_64-linux-gnu" ldd "$CHROME" 2>&1 | grep 'not found' | awk '{print $1}' | sort -u | tr '\n' ' ' || true)"
if [ -n "$missing" ]; then echo "[setup] still missing: $missing" >&2; exit 1; fi
echo "[setup] Chromium ready: $CHROME"
