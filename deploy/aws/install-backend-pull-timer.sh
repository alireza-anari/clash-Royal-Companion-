#!/usr/bin/env bash
# One-time install for the CRC EC2 development checkout. No OIDC, permanent
# GitHub credentials, public listener, AI activation or service restart.
set -Eeuo pipefail
umask 077
[[ "$(id -u)" == 0 ]] || { echo "Root required for one-time timer installation."; exit 1; }
id ec2-user >/dev/null
for cmd in curl git python3 systemctl install; do command -v "$cmd" >/dev/null; done
ROOT=/opt/clash-royale-companion/backend
[[ -d "$ROOT/.git" ]] || { echo "CRC backend checkout missing."; exit 1; }
REV=c611a0ac34c1b62931f7f702b4936932e0533739
TMP="$(mktemp -d /tmp/crc-backend-install.XXXXXXXX)"
trap 'rm -rf -- "$TMP"' EXIT
curl -fsSL --max-time 30 "https://raw.githubusercontent.com/alireza-anari/clash-Royal-Companion-/$REV/deploy/aws/sync-private-backend.sh" -o "$TMP/sync"
bash -n "$TMP/sync"
install -o root -g root -m 0755 "$TMP/sync" /usr/local/sbin/crc-sync-private-backend
cat > "$TMP/check" <<'SCRIPT'
#!/usr/bin/env bash
set -Eeuo pipefail
export GIT_TERMINAL_PROMPT=0
cd /opt/clash-royale-companion/backend
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
WorkingDirectory=/opt/clash-royale-companion/backend
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
echo "CRC backend CI-gated autosync timer installed. Code only; no backend or AI service activated."
