#!/usr/bin/env bash
# One-time setup from AWS Systems Manager Run Command. No SSH key or PAT.
set -Eeuo pipefail
umask 077

[[ "$(id -u)" -eq 0 ]] || {
  echo "Installer must run as root through AWS Systems Manager." >&2
  exit 1
}
REV="${1:?Pass the pinned Git commit SHA to this installer}"
[[ "$REV" =~ ^[0-9a-f]{40}$ ]] || {
  echo "Invalid immutable Git commit SHA." >&2
  exit 1
}
command -v curl >/dev/null
command -v systemctl >/dev/null
id ec2-user >/dev/null

TMP="$(mktemp -d /tmp/crc-autosync-install.XXXXXXXX)"
trap 'rm -rf -- "$TMP"' EXIT
curl --fail --location --silent --show-error --max-time 30 \
  "https://raw.githubusercontent.com/alireza-anari/clash-Royal-Companion-/${REV}/deploy/aws/sync-coach-frontend.sh" \
  --output "$TMP/sync-coach-frontend.sh"
[[ -s "$TMP/sync-coach-frontend.sh" ]] || exit 1
install -o root -g root -m 0755 "$TMP/sync-coach-frontend.sh" \
  /usr/local/sbin/crc-sync-coach-frontend

cat > /etc/systemd/system/crc-sync-coach-frontend.service <<'SERVICE'
[Unit]
Description=Clash Royale Companion safe frontend GitHub pull
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
User=ec2-user
Group=ec2-user
WorkingDirectory=/opt/clash-royale-companion/frontend
Environment=GIT_TERMINAL_PROMPT=0
ExecStart=/usr/local/sbin/crc-sync-coach-frontend
TimeoutStartSec=180
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

cat > /etc/systemd/system/crc-sync-coach-frontend.timer <<'TIMER'
[Unit]
Description=Check GitHub development frontend every two minutes

[Timer]
OnBootSec=2min
OnUnitInactiveSec=2min
RandomizedDelaySec=15s
AccuracySec=30s
Unit=crc-sync-coach-frontend.service

[Install]
WantedBy=timers.target
TIMER

systemctl daemon-reload
systemctl enable --now crc-sync-coach-frontend.timer
echo "GitHub frontend auto-sync timer installed and enabled."
echo "The timer runs as ec2-user, refuses dirty/non-fast-forward checkouts,"
echo "and does not restart backend or publish Cloudflare."
systemctl list-timers --all --no-pager crc-sync-coach-frontend.timer
