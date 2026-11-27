#!/usr/bin/env bash
# One-time install for the CRC EC2 development checkout. No OIDC, permanent
# GitHub credentials, public listener, AI activation or service restart.
set -Eeuo pipefail
umask 077
[[ "$(id -u)" == 0 ]] || { echo "Root required for one-time timer installation."; exit 1; }
id ec2-user >/dev/null
for cmd in curl git python3 systemctl install sed grep runuser timeout; do command -v "$cmd" >/dev/null; done
# Existing backend may be an extracted release, not a Git clone.
# Preserve it, its config and running processes; use a separate dev worktree.
ROOT=/opt/clash-royale-companion/backend-github
REMOTE=https://github.com/alireza-anari/clash-Royal-Companion-.git
BRANCH=feat/backend-bootstrap
REV=c611a0ac34c1b62931f7f702b4936932e0533739
# REV is the previously CI-verified commit used as the initial baseline.
as_ec2() { runuser -u ec2-user -- env GIT_TERMINAL_PROMPT=0 "$@"; }
command -v runuser >/dev/null
[[ ! -L "$ROOT" ]] || { echo "Refusing: sync path is a symlink."; exit 1; }
if [[ ! -e "$ROOT" ]]; then
  install -d -o ec2-user -g ec2-user -m 0750 "$ROOT"
  as_ec2 git clone --no-checkout --single-branch --branch "$BRANCH" "$REMOTE" "$ROOT"
  as_ec2 git -C "$ROOT" merge-base --is-ancestor "$REV" "refs/remotes/origin/$BRANCH"
  as_ec2 git -C "$ROOT" checkout -B "$BRANCH" "$REV"
fi
[[ "$(as_ec2 git -C "$ROOT" rev-parse --show-toplevel 2>/dev/null)" == "$ROOT" ]] || {
  echo "Dedicated sync path exists but is not a Git checkout; preserved without modification."; exit 1;
}
[[ "$(as_ec2 git -C "$ROOT" branch --show-current)" == "$BRANCH" ]]
[[ "$(as_ec2 git -C "$ROOT" remote get-url origin)" == "$REMOTE" ]]
[[ -z "$(as_ec2 git -C "$ROOT" status --porcelain --untracked-files=normal)" ]] || {
  echo "Dedicated sync checkout contains local changes; preserved."; exit 1;
}
echo "Dedicated backend Git checkout: ready (existing backend preserved)."
TMP="$(mktemp -d /tmp/crc-backend-install.XXXXXXXX)"
trap 'rm -rf -- "$TMP"' EXIT
curl -fsSL --max-time 30 "https://raw.githubusercontent.com/alireza-anari/clash-Royal-Companion-/$REV/deploy/aws/sync-private-backend.sh" -o "$TMP/sync"
# The pinned sync helper is restricted to the new development worktree.
grep -Fx 'readonly ROOT="/opt/clash-royale-companion/backend"' "$TMP/sync" >/dev/null || {
  echo "Refusing: pinned sync helper has an unexpected root declaration."; exit 1;
}
sed -i 's|^readonly ROOT="/opt/clash-royale-companion/backend"$|readonly ROOT="/opt/clash-royale-companion/backend-github"|' "$TMP/sync"
grep -Fx 'readonly ROOT="/opt/clash-royale-companion/backend-github"' "$TMP/sync" >/dev/null || {
  echo "Refusing: could not restrict sync helper to the dedicated checkout."; exit 1;
}
bash -n "$TMP/sync"
install -o root -g root -m 0755 "$TMP/sync" /usr/local/sbin/crc-sync-private-backend
cat > "$TMP/check" <<'SCRIPT'
#!/usr/bin/env bash
set -Eeuo pipefail
export GIT_TERMINAL_PROMPT=0
cd /opt/clash-royale-companion/backend-github
[[ "$(id -un)" == ec2-user ]]
[[ "$(git branch --show-current)" == feat/backend-bootstrap ]]
[[ "$(git remote get-url origin)" == https://github.com/alireza-anari/clash-Royal-Companion-.git ]]
[[ -z "$(git status --porcelain --untracked-files=normal)" ]] || { echo "Backend checkout has local changes; skipped."; exit 1; }
TARGET="$(timeout 30 git ls-remote --exit-code origin refs/heads/feat/backend-bootstrap | cut -f1)"
[[ "$TARGET" =~ ^[0-9a-f]{40}$ ]]
if [[ "$(git rev-parse HEAD)" == "$TARGET" ]]; then
  echo "Backend already synchronized: $TARGET"
  exit 0
fi
if ! python3 - "$TARGET" <<'PY'
import json, sys, urllib.request, urllib.parse
sha = sys.argv[1]
params = urllib.parse.urlencode({"head_sha": sha, "branch": "feat/backend-bootstrap", "event": "push", "per_page": 20})
url = "https://api.github.com/repos/alireza-anari/clash-Royal-Companion-/actions/workflows/backend-tests.yml/runs?" + params
request = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json", "User-Agent": "CRC-backend-sync"})
try:
    with urllib.request.urlopen(request, timeout=15) as response:
        data = json.load(response)
    runs = data.get("workflow_runs", [])
    if not any(r.get("head_sha") == sha and r.get("head_branch") == "feat/backend-bootstrap"
               and r.get("event") == "push" and r.get("conclusion") == "success"
               and r.get("status") == "completed" for r in runs):
        raise SystemExit(1)
except Exception:
    raise SystemExit(1) from None
PY
then
  echo "Backend revision is not yet confirmed by GitHub CI; skipped."
  exit 0
fi
exec /usr/local/sbin/crc-sync-private-backend "$TARGET"
SCRIPT
bash -n "$TMP/check"
install -o root -g root -m 0755 "$TMP/check" /usr/local/sbin/crc-check-private-backend
cat > /etc/systemd/system/crc-sync-private-backend.service <<'SERVICE'
[Unit]
Description=CRC verified GitHub backend development code sync
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
User=ec2-user
Group=ec2-user
WorkingDirectory=/opt/clash-royale-companion/backend-github
ExecStart=/usr/local/sbin/crc-check-private-backend
TimeoutStartSec=240
MemoryMax=384M
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=full
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
CapabilityBoundingSet=
AmbientCapabilities=
UMask=0077
SERVICE
cat > /etc/systemd/system/crc-sync-private-backend.timer <<'TIMER'
[Unit]
Description=Check CRC verified GitHub backend every five minutes
[Timer]
OnBootSec=2min
OnUnitInactiveSec=5min
RandomizedDelaySec=15s
Unit=crc-sync-private-backend.service
[Install]
WantedBy=timers.target
TIMER
systemctl daemon-reload
systemctl enable --now crc-sync-private-backend.timer
systemctl is-enabled --quiet crc-sync-private-backend.timer
systemctl is-active --quiet crc-sync-private-backend.timer
echo "CRC backend CI-gated autosync timer installed and active. Code only; no backend or AI service activated."
# Run the first check now, but keep installation and sync outcomes distinct.
if systemctl start crc-sync-private-backend.service; then
  echo "Initial backend sync check: completed."
else
  echo "Initial backend sync check: failed; timer remains enabled."
  journalctl -u crc-sync-private-backend.service -n 12 --no-pager
  exit 1
fi
systemctl list-timers --all --no-pager crc-sync-private-backend.timer
journalctl -u crc-sync-private-backend.service -n 12 --no-pager
