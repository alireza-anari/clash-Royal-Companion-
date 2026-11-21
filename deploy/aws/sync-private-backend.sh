#!/usr/bin/env bash
# Safe one-way GitHub fast-forward for CRC *private backend* checkout.
# Invoked by an IAM-scoped AWS Systems Manager command, never by a public Worker.
# Does not read secrets, change the database, install services or restart processes.
set -Eeuo pipefail
umask 077
export GIT_TERMINAL_PROMPT=0

readonly ROOT="/opt/clash-royale-companion/backend"
readonly BRANCH="feat/backend-bootstrap"
readonly REMOTE="https://github.com/alireza-anari/clash-Royal-Companion-.git"
readonly EXPECTED_SHA="${1:-}"

[[ "$(id -un)" == "ec2-user" ]] || { echo "Refusing: expected ec2-user."; exit 1; }
[[ "$EXPECTED_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "Refusing: invalid commit."; exit 1; }
for tool in git python3 timeout tar mktemp; do command -v "$tool" >/dev/null; done
[[ -d "$ROOT/.git" && -d "$ROOT/api/src/crc_api" ]] || {
  echo "Refusing: expected backend checkout is missing."; exit 1;
}
cd "$ROOT"

[[ "$(git branch --show-current)" == "$BRANCH" ]] || {
  echo "Refusing: unexpected backend branch."; exit 1;
}
[[ "$(git remote get-url origin)" == "$REMOTE" ]] || {
  echo "Refusing: unexpected backend origin."; exit 1;
}
[[ -z "$(git status --porcelain --untracked-files=normal)" ]] || {
  echo "Refusing: local backend changes detected."; exit 1;
}

timeout 120 git fetch --quiet --no-tags "$REMOTE" "refs/heads/$BRANCH"
TARGET="$(git rev-parse FETCH_HEAD)"
CURRENT="$(git rev-parse HEAD)"
[[ "$TARGET" == "$EXPECTED_SHA" ]] || {
  echo "Refusing: GitHub branch head changed since verification."; exit 1;
}
if [[ "$TARGET" == "$CURRENT" ]]; then
  echo "Already synchronized backend: $CURRENT"
  exit 0
fi
git merge-base --is-ancestor "$CURRENT" "$TARGET" || {
  echo "Refusing: backend update is not a fast-forward."; exit 1;
}
STAGE="$(mktemp -d /tmp/crc-backend-check.XXXXXXXX)"
trap 'rm -rf -- "$STAGE"' EXIT
git archive "$TARGET" | tar -xf - -C "$STAGE"
python3 - "$STAGE" <<'PY'
import ast
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
paths = list((root / "api" / "src" / "crc_api").rglob("*.py"))
paths += list((root / "api" / "tests").rglob("*.py"))
if not paths or not (root / "api" / "src" / "crc_api" / "ai_coach.py").is_file():
    raise SystemExit("Refusing: required backend sources are missing.")
for path in paths:
    ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
print(f"Backend syntax verified for {len(paths)} Python files.")
PY
git diff --check "$CURRENT" "$TARGET"
git merge --ff-only "$TARGET"
echo "Backend EC2 worktree synchronized: $CURRENT -> $TARGET"
echo "No service restarted, migration applied, secret read or provider invoked."
