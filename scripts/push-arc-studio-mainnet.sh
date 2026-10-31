#!/usr/bin/env bash
# push-arc-studio-mainnet.sh
#
# Pushes the arc-studio/mainnet branch to GitHub after gh authentication.
# Run this AFTER completing `gh auth login` in your terminal.
#
# Usage:
#   bash scripts/push-arc-studio-mainnet.sh
#
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)/Veyra-github"
BRANCH="arc-studio/mainnet"
EXPECTED_COMMIT="ed6f58e"

echo "=== Veyra arc-studio/mainnet push ==="

# Verify gh is authenticated
if ! gh auth status >/dev/null 2>&1; then
  echo ""
  echo "ERROR: GitHub CLI is not authenticated."
  echo ""
  echo "Run the following command in your terminal to authenticate:"
  echo ""
  echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
  echo "  gh auth login"
  echo ""
  echo "Choose: GitHub.com → HTTPS → Login with a web browser"
  echo "Then re-run this script."
  exit 1
fi

echo "GitHub CLI authenticated."

# Wire up gh auth for git operations
export PATH="$HOME/.local/bin:$PATH"
gh auth setup-git

# Verify the commit is what we expect
ACTUAL=$(git -C "$REPO_DIR" log --oneline -1 "$BRANCH" 2>/dev/null | awk '{print $1}')
if [ "$ACTUAL" != "$EXPECTED_COMMIT" ]; then
  echo "WARNING: HEAD of $BRANCH is $ACTUAL, expected $EXPECTED_COMMIT"
  echo "Proceeding anyway — review the diff before merging."
fi

# Push
echo "Pushing $BRANCH to origin..."
git -C "$REPO_DIR" push origin "$BRANCH"
echo ""

# Verify remote has the branch
echo "Verifying remote branch..."
REMOTE_SHA=$(git -C "$REPO_DIR" ls-remote origin "refs/heads/$BRANCH" | awk '{print substr($1,1,7)}')
LOCAL_SHA=$(git -C "$REPO_DIR" rev-parse --short "$BRANCH")

if [ "$REMOTE_SHA" = "$LOCAL_SHA" ]; then
  echo "Remote branch verified: $BRANCH @ $REMOTE_SHA"
  echo ""
  echo "Branch is live at:"
  echo "  https://github.com/bearbaba/Veyra/tree/$BRANCH"
  echo ""
  echo "To open a PR from this branch:"
  echo "  gh pr create --repo bearbaba/Veyra --head $BRANCH --base develop \\"
  echo "    --title 'feat(arc-studio/mainnet): Arc Mainnet identity + Settlement + X OAuth hardening' \\"
  echo "    --body 'See docs/mainnet-deploy-procedure.md and AGENTS.md for full context.'"
else
  echo "WARNING: Remote SHA ($REMOTE_SHA) does not match local ($LOCAL_SHA)"
  echo "Push may not have completed — check your network and retry."
  exit 1
fi
