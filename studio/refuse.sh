#!/usr/bin/env bash
# Used by the Studio workspace root for every package script that is not
# explicitly safe to run from there. Exists so that a command can never
# silently fall through to the outdated workspace-root snapshot.
#
#   refuse.sh <script-name>
name="${1:-this command}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cat >&2 <<EOF
[studio] "$name" is not available from the Studio workspace root.

The workspace root holds an outdated snapshot, not the application. This script
may touch deployments, databases or funds, so it is never delegated implicitly.
If you really mean to run the repository's script, do it deliberately:

    cd "$REPO" && bun run $name
EOF
exit 1
