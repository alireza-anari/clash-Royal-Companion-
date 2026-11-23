#!/usr/bin/env bash
# Stage and import-check private beta Python dependencies as ec2-user.
# Explicitly DOES NOT install systemd services, connect Tunnel, mutate DB, or start an API.
set -Eeuo pipefail
umask 077
export GIT_TERMINAL_PROMPT=0
export PIP_DISABLE_PIP_VERSION_CHECK=1
export PYTHONDONTWRITEBYTECODE=1

readonly CHECKOUT=/opt/clash-royale-companion/backend-github
readonly BRANCH=feat/backend-bootstrap
readonly REMOTE=https://github.com/alireza-anari/clash-Royal-Companion-.git
readonly STAGE_ROOT=/home/ec2-user/crc-beta-staging

refuse() { printf 'REFUSED: %s\n' "$1" >&2; exit 1; }
[[ "$(id -un)" == ec2-user && "$HOME" == /home/ec2-user ]] || refuse 'run as ec2-user, not with sudo'
for cmd in python3.12 git tar ss df awk stat env; do
  command -v "$cmd" >/dev/null 2>&1 || refuse "missing command: $cmd"
done
python3.12 -c 'import sys, ssl, venv; assert sys.version_info >= (3, 12)' || refuse 'Python 3.12 venv/SSL unavailable'
[[ -d "$CHECKOUT/.git" && ! -L "$CHECKOUT" ]] || refuse 'dedicated Git checkout missing or symlinked'
[[ "$(git -C "$CHECKOUT" branch --show-current)" == "$BRANCH" ]] || refuse 'unexpected branch'
[[ "$(git -C "$CHECKOUT" remote get-url origin)" == "$REMOTE" ]] || refuse 'unexpected origin'
[[ -z "$(git -C "$CHECKOUT" status --porcelain --untracked-files=normal)" ]] || refuse 'checkout contains local changes'
[[ -f "$CHECKOUT/api/pyproject.toml" && -f "$CHECKOUT/api/src/crc_api/beta_gateway.py" ]] || refuse 'beta sources missing'

# Fail closed if port cannot be inspected, or a beta listener is present.
if ! listener="$(ss -H -ltn '( sport = :8001 )' 2>/dev/null)"; then
  refuse 'could not check beta port 8001'
fi
[[ -z "$listener" ]] || refuse 'port 8001 already has a TCP listener'
if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet crc-private-beta.service; then
  refuse 'private beta service is already running'
fi
free_kb="$(df -Pk /home/ec2-user | awk 'NR == 2 { print $4 }')"
[[ "$free_kb" =~ ^[0-9]+$ && "$free_kb" -ge 1048576 ]] || refuse 'need at least 1 GiB free for staging'

sha="$(git -C "$CHECKOUT" rev-parse --verify HEAD)"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || refuse 'invalid Git revision'
[[ ! -L "$STAGE_ROOT" ]] || refuse 'staging root is a symlink'
if [[ ! -d "$STAGE_ROOT" ]]; then
  mkdir -m 0700 "$STAGE_ROOT"
fi
[[ -d "$STAGE_ROOT" && "$(stat -c %u "$STAGE_ROOT")" == "$(id -u)" ]] || refuse 'staging directory owner mismatch'
chmod 0700 "$STAGE_ROOT"
dest="$STAGE_ROOT/$sha"
[[ ! -L "$dest" ]] || refuse 'revision path is a symlink'
if [[ -d "$dest" ]]; then
  if [[ -f "$dest/READY_SHA" && "$(cat "$dest/READY_SHA")" == "$sha" && -x "$dest/venv/bin/python" ]]; then
    printf 'ALREADY STAGED: %s\n' "$sha"
    printf 'No services started or changed.\n'
    exit 0
  fi
  refuse 'revision directory exists but is incomplete; preserved for operator review'
fi

mkdir -m 0700 "$dest"
success=0
cleanup_incomplete() {
  if [[ "$success" != 1 ]]; then
    # Only the exact revision directory created above can be cleaned up.
    rm -rf -- "$dest"
  fi
}
trap cleanup_incomplete EXIT

# Archive tracked sources, leaving the CI-gated sync checkout pristine.
git -C "$CHECKOUT" archive "$sha" api | tar -xf - -C "$dest"
python3.12 -m venv "$dest/venv"
"$dest/venv/bin/python" -m pip install --no-cache-dir --no-compile "$dest/api[security]"
"$dest/venv/bin/python" -m pip check

# Import check and explicit fail-closed configuration test. No uvicorn, DB or network call.
env -u CRC_BETA_RUNTIME_GATE -u PYTHONPATH "$dest/venv/bin/python" -c '
from crc_api.beta_gateway import BetaConfig, UnsafeBetaConfiguration
from crc_api.security.shared_quota import PostgresSharedQuota
import fastapi, uvicorn, jwt, asyncpg
try:
    BetaConfig.from_environment()
except UnsafeBetaConfiguration:
    print("Private beta config gate: CLOSED (expected)")
else:
    raise SystemExit("REFUSED: beta configuration gate unexpectedly open")
'
printf '%s\n' "$sha" > "$dest/READY_SHA"
success=1
printf 'STAGED SUCCESSFULLY: %s\n' "$sha"
printf 'Python: %s\n' "$dest/venv/bin/python"
printf '%s\n' 'No systemd unit installed, no service started, no TCP port opened.'
printf '%s\n' 'No Cloudflare, Supercell, OpenRouter, or PostgreSQL request made.'
