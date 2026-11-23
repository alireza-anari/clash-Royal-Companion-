#!/usr/bin/env bash
# Independently verify Docker DNS + PostgreSQL TCP TLS from a disposable client.
# This performs a read-only network handshake, not a database login or beta start.
set -Eeuo pipefail
umask 077
export LC_ALL=C

readonly CA=/etc/crc-beta/trust/db-ca.crt
readonly PIN=a274759c3a0e05262625f95af35165aa6628fdf459f14958aefa13f68be60a56
refuse() { printf 'REFUSED: %s\n' "$1" >&2; exit 1; }
[[ "$(id -un)" == ec2-user ]] || refuse 'run as ec2-user without sudo on the script'
for tool in sudo docker timeout openssl sed tr; do
  command -v "$tool" >/dev/null 2>&1 || refuse "missing command: $tool"
done

printf '%s\n' 'CRC standalone TLS client: READ-ONLY; no database credentials.'
[[ -f "$CA" && ! -L "$CA" ]] || refuse 'staged public CA missing'
actual="$(openssl x509 -in "$CA" -noout -fingerprint -sha256 2>/dev/null |
  sed -n 's/^sha256 Fingerprint=//p' | tr -d ':' | tr 'A-F' 'a-f')"
[[ "$actual" == "$PIN" ]] || refuse 'unexpected CA certificate'
db="$(sudo -n docker inspect --format '{{.Config.Image}}|{{.State.Status}}|{{.State.Health.Status}}|{{.HostConfig.NetworkMode}}' crc-postgres 2>/dev/null)" ||
  refuse 'PostgreSQL container not available'
[[ "$db" == 'postgres:17|running|healthy|crc-private' ]] || refuse 'unexpected DB state'
network="$(sudo -n docker network inspect --format '{{.Driver}}|{{.Internal}}' crc-private 2>/dev/null)" ||
  refuse 'private Docker network not available'
[[ "$network" == 'bridge|true' ]] || refuse 'Docker network is not an internal bridge'
if published="$(sudo -n docker port crc-postgres 5432/tcp 2>/dev/null)" && [[ -n "$published" ]]; then
  refuse 'DB port published on host: stop and review exposure'
fi
sudo -n docker image inspect postgres:17 >/dev/null 2>&1 ||
  refuse 'existing postgres:17 image unavailable; do not pull a new image here'

run_probe() {
  local hostname="$1"
  timeout 35 sudo -n docker run --rm --pull never \
    --network crc-private \
    --read-only \
    --user 10001:10001 \
    --cap-drop ALL \
    --pids-limit 48 \
    --memory 128m \
    --security-opt no-new-privileges \
    --mount "type=bind,src=$CA,dst=/run/crc-beta/db-ca/ca.crt,readonly" \
    --entrypoint sh postgres:17 -ec '
      test -r /run/crc-beta/db-ca/ca.crt
      exec openssl s_client -starttls postgres -connect crc-postgres:5432 \
        -servername crc-postgres \
        -CAfile /run/crc-beta/db-ca/ca.crt \
        -verify_hostname "$1" -verify_return_error -brief </dev/null
    ' -- "$hostname" 2>&1
}

# NEVER display raw OpenSSL output (could include subjects, internal addresses).
if output="$(run_probe crc-postgres)"; then
  if printf '%s\n' "$output" | grep -Fxq 'CONNECTION ESTABLISHED' &&
     printf '%s\n' "$output" | grep -Eq '^Protocol version: TLSv1\.[23]$' &&
     printf '%s\n' "$output" | grep -Fxq 'Verification: OK'; then
    printf '%s\n' 'INDEPENDENT_CLIENT_TLS=verified'
  else
    printf '%s\n' 'INDEPENDENT_CLIENT_TLS=not_proven (handshake evidence incomplete)'
    exit 2
  fi
else
  printf '%s\n' 'INDEPENDENT_CLIENT_TLS=failed (network, certificate, or tool error)'
  exit 2
fi

# Ensure hostname verification is actually enforced (same CA, wrong DNS name).
if run_probe wrong-postgres-hostname >/dev/null 2>&1; then
  printf '%s\n' 'NEGATIVE_HOSTNAME_CHECK=FAILED (unsafe client)'
  exit 2
fi
printf '%s\n' 'NEGATIVE_HOSTNAME_CHECK=denied_as_expected'
printf '%s\n' 'CRC_APP_AUTH=not_tested (requires protected credentials)'
printf '%s\n' 'No live beta service, persistent containers, database writes, new ports or public ingress.'
