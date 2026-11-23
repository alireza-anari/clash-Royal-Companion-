#!/usr/bin/env bash
# CRC PostgreSQL TCP/TLS handshake using the container's default OS CA store.
# Read only; deliberately does not configure CA trust or start another container.
# This checks the TLS layer INSIDE the existing DB container, not future beta-to-DB reachability.
set -Eeuo pipefail
umask 077
export LC_ALL=C

refuse() { printf 'REFUSED: %s\n' "$1" >&2; exit 1; }
[[ "$(id -un)" == ec2-user ]] || refuse 'run as ec2-user, without sudo on the script'
for cmd in sudo docker timeout grep; do
  command -v "$cmd" >/dev/null 2>&1 || refuse "missing tool: $cmd"
done

printf '%s\n' 'CRC Postgres TLS test: READ ONLY, STRICT DEFAULT TRUST.'
if ! meta="$(sudo -n docker inspect --format '{{.Config.Image}}|{{.State.Status}}|{{.State.Health.Status}}|{{.HostConfig.NetworkMode}}' crc-postgres 2>/dev/null)"; then
  refuse 'database container unavailable'
fi
[[ "$meta" == 'postgres:17|running|healthy|crc-private' ]] ||
  refuse 'database container differs from reviewed configuration'

# OpenSSL performs PostgreSQL SSLRequest negotiation (not a plaintext probe).
# -verify_return_error aborts if the peer is not trusted; -verify_hostname pins
# the DNS name. Never use -verify 0, sslmode=require or accept self-signed
# leaf certs solely because they were read from the same untrusted endpoint.
# Capture and DISCARD raw tool output; it could include certificate subjects,
# internal paths, errors or infrastructure identifiers.
if transcript="$(timeout 18 sudo -n docker exec --user postgres crc-postgres \
  sh -ec '
    command -v openssl >/dev/null 2>&1 || exit 11
    exec openssl s_client -starttls postgres -connect 127.0.0.1:5432 \
      -servername crc-postgres -verify_hostname crc-postgres \
      -verify_return_error -brief </dev/null
  ' 2>&1)"; then
  if printf '%s\n' "$transcript" | grep -Fxq 'CONNECTION ESTABLISHED' &&
     printf '%s\n' "$transcript" | grep -Eq '^Protocol version: TLSv1\.[23]$' &&
     printf '%s\n' "$transcript" | grep -Fxq 'Verification: OK'; then
    printf '%s\n' 'TLS_DEFAULT_CA_AND_HOSTNAME=verified'
    printf '%s\n' 'TLS_ENCRYPTED_HANDSHAKE=established'
  else
    printf '%s\n' 'TLS_DEFAULT_CA_AND_HOSTNAME=not_proven (incomplete handshake evidence)'
    printf '%s\n' 'TLS_ENCRYPTED_HANDSHAKE=unknown'
  fi
else
  printf '%s\n' 'TLS_DEFAULT_CA_AND_HOSTNAME=not_verified (untrusted certificate, TLS error, or unavailable tool)'
  printf '%s\n' 'TLS_ENCRYPTED_HANDSHAKE=unknown'
fi

printf '%s\n' 'BETA_TO_DB_VERIFY_FULL=not_tested (requires independent client, verified CA, Docker DNS, credentialed auth)'
printf '%s\n' 'No secrets, CA files, certificates, passwords, SQL writes, containers, services, network or ports modified.'
