#!/usr/bin/env bash
# CRC private-beta host-path diagnostic. READ ONLY.
# This does not configure, start, stop, or expose any service.
# Run on the existing CRC EC2 host via an approved SSM session.
# Never pass credentials, invite codes, JWTs or connection strings as arguments.
set -Eeuo pipefail
export LC_ALL=C

printf '%s\n' 'CRC private-beta local path: READ-ONLY DIAGNOSTIC'
printf '%s\n' 'This is not a beta activation or a successful end-to-end check.'

show_unit() {
  local unit="$1" load="unknown" active="unknown"
  if command -v systemctl >/dev/null 2>&1; then
    load="$(systemctl show "$unit" -p LoadState --value 2>/dev/null || true)"
    active="$(systemctl is-active "$unit" 2>/dev/null || true)"
  fi
  [[ -n "$load" ]] || load="unknown"
  [[ -n "$active" ]] || active="unknown"
  printf 'service %s: loaded=%s active=%s\n' "$unit" "$load" "$active"
}

show_unit crc-private-beta.service
show_unit crc-local-api.service
show_unit cloudflared.service

# Report only local listening ADDRESS, never process arguments or environment.
if command -v ss >/dev/null 2>&1; then
  listeners="$(ss -H -ltn '( sport = :8000 )' 2>/dev/null || true)"
  if [[ -z "$listeners" ]]; then
    printf '%s\n' 'port 8000: no local TCP listener observed'
  elif printf '%s\n' "$listeners" | awk '{print $4}' |
       grep -Eq '^(\*|0\.0\.0\.0|\[::\]|::):8000$'; then
    printf '%s\n' 'port 8000: WARNING - wildcard listener; investigate before any beta activation'
  else
    printf '%s\n' 'port 8000: listener observed (check which service owns it)'
  fi
else
  printf '%s\n' 'port 8000: not checked (ss unavailable)'
fi

# Beta must use a dedicated port while crc-local-api stays on 8000.
# Report port occupancy only: no process names, arguments or secrets.
if command -v ss >/dev/null 2>&1; then
  beta_listeners="$(ss -H -ltn '( sport = :8001 )' 2>/dev/null || true)"
  if [[ -z "$beta_listeners" ]]; then
    printf '%s\n' 'port 8001: free of observed TCP listeners (candidate for isolated beta)'
  else
    printf '%s\n' 'port 8001: OCCUPIED; do not deploy beta on this port without review'
  fi
else
  printf '%s\n' 'port 8001: not checked (ss unavailable)'
fi
# A Docker cloudflared on a bridge cannot reach the host loopback address
# just because its VPC Service is configured to use 127.0.0.1.
if command -v docker >/dev/null 2>&1; then
  containers="$(docker ps --format '{{.ID}} {{.Image}}' 2>/dev/null || true)"
  count=0
  while read -r container_id image; do
    [[ "$image" == *cloudflared* && -n "$container_id" ]] || continue
    count=$((count + 1))
    network_mode="$(docker inspect --format '{{.HostConfig.NetworkMode}}' "$container_id" 2>/dev/null || true)"
    case "$network_mode" in
      host) printf '%s\n' 'cloudflared container: host network detected (not proof of connectivity)' ;;
      "") printf '%s\n' 'cloudflared container: network mode unknown' ;;
      *) printf '%s\n' 'cloudflared container: non-host network; host-loopback origin may be unreachable' ;;
    esac
  done <<< "$containers"
  if [[ "$count" -eq 0 ]]; then
    printf '%s\n' 'cloudflared container: none found (or Docker not readable)'
  fi
else
  printf '%s\n' 'cloudflared container: not checked (Docker unavailable)'
fi

printf '%s\n' 'No processes, secrets, firewall rules, ports, services, or cloud resources were modified.'
printf '%s\n' 'Cloudflare-side tunnel status, invite authentication and quota DB require separate checks.'
