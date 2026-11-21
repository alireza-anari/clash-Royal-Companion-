#!/usr/bin/env bash
# Clash Royale Companion: read-only remote fetch + safe fast-forward of the
# frontend development worktree. Does NOT publish Cloudflare or restart APIs.
set -Eeuo pipefail
umask 077
export GIT_TERMINAL_PROMPT=0

ROOT="/opt/clash-royale-companion/frontend"
BRANCH="feat/mvp-coach-offline"
REMOTE="https://github.com/alireza-anari/clash-Royal-Companion-.git"

if [[ "$(id -un)" != "ec2-user" ]]; then
  echo "Refusing: this updater must run as unprivileged ec2-user." >&2
  exit 1
fi
command -v git >/dev/null
command -v node >/dev/null
[[ -d "$ROOT/site" ]] || { echo "Frontend checkout missing." >&2; exit 1; }
cd "$ROOT"

[[ "$(git branch --show-current)" == "$BRANCH" ]] || {
  echo "Refusing: checkout is not on $BRANCH." >&2; exit 1;
}
[[ -z "$(git status --porcelain --untracked-files=normal)" ]] || {
  echo "Refusing: local edits are present; no automatic overwrite." >&2; exit 1;
}

timeout 120 git fetch --quiet --no-tags "$REMOTE" "refs/heads/$BRANCH"
TARGET="$(git rev-parse FETCH_HEAD)"
CURRENT="$(git rev-parse HEAD)"
[[ "$TARGET" =~ ^[0-9a-f]{40}$ ]] || exit 1

if [[ "$TARGET" == "$CURRENT" ]]; then
  echo "Already synchronized: $CURRENT"
  exit 0
fi

git merge-base --is-ancestor "$CURRENT" "$TARGET" || {
  echo "Refusing: remote update is not a fast-forward." >&2; exit 1;
}

STAGE="$(mktemp -d /tmp/crc-frontend-check.XXXXXXXX)"
trap 'rm -rf -- "$STAGE"' EXIT
git archive "$TARGET" | tar -xf - -C "$STAGE"

for file in \
  site/app.js site/battle-insights.js site/offline-coach.js \
  site/backend-client.js site/owned-options.js \
  deploy/cloudflare/mvp-worker.js; do
  node --check "$STAGE/$file"
done
(cd "$STAGE" && node deploy/cloudflare/build-site.mjs --check)
git diff --check "$CURRENT" "$TARGET"

git merge --ff-only "$TARGET"
echo "Frontend EC2 worktree updated: $CURRENT -> $TARGET"
echo "Cloudflare public stage and local FastAPI were NOT deployed/restarted."
