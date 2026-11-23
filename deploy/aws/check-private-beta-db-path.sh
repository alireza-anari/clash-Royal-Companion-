#!/usr/bin/env bash
# Redacted read-only DB grants, Docker topology and certificate metadata.
# This is NOT a successful TLS verify-full connection or beta deployment.
set -Eeuo pipefail
umask 077
export LC_ALL=C
refuse() { printf 'REFUSED: %s\n' "$1" >&2; exit 1; }
[[ "$(id -un)" == ec2-user ]] || refuse 'run as ec2-user, not as root'
for program in sudo docker timeout; do
  command -v "$program" >/dev/null 2>&1 || refuse "missing $program"
done
printf '%s\n' 'CRC beta DB path: READ-ONLY REDACTED INVENTORY'

if ! metadata="$(sudo -n docker inspect --format '{{.Config.Image}}|{{.State.Status}}|{{.State.Health.Status}}|{{.HostConfig.NetworkMode}}' crc-postgres 2>/dev/null)"; then
  refuse 'PostgreSQL container metadata unavailable'
fi
[[ "$metadata" == 'postgres:17|running|healthy|crc-private' ]] ||
  refuse 'PostgreSQL container differs from previously inspected state'
printf '%s\n' 'DB_CONTAINER=healthy_on_crc-private'
if network="$(sudo -n docker network inspect --format '{{.Driver}}|{{.Internal}}' crc-private 2>/dev/null)"; then
  case "$network" in
    'bridge|true') printf '%s\n' 'DOCKER_NETWORK=internal_bridge' ;;
    'bridge|false') printf '%s\n' 'DOCKER_NETWORK=bridge' ;;
    *) printf '%s\n' 'DOCKER_NETWORK=unknown_type' ;;
  esac
else
  printf '%s\n' 'DOCKER_NETWORK=not_readable'
fi

# Feed fixed read-only SQL through stdin. The configured bootstrap role/database
# are expanded inside Docker and are NEVER printed by this script.
query="$(cat <<'SQL'
SELECT 'SCHEMA_USAGE=' || has_schema_privilege('crc_app','public','USAGE')::text;
SELECT 'QUOTA_SELECT=' || has_table_privilege('crc_app','public.gateway_quota_windows','SELECT')::text;
SELECT 'QUOTA_INSERT=' || has_table_privilege('crc_app','public.gateway_quota_windows','INSERT')::text;
SELECT 'QUOTA_UPDATE=' || has_table_privilege('crc_app','public.gateway_quota_windows','UPDATE')::text;
SQL
)"
if sql_output="$(printf '%s\n' "$query" | timeout 20 sudo -n docker exec -i --user postgres crc-postgres \
  env -u PGPASSWORD -u PGUSER -u PGDATABASE -u PGHOST -u PGSERVICE \
  sh -eu -c '
    [ -n "$POSTGRES_USER" ] || exit 9
    db="$POSTGRES_DB"
    [ -n "$db" ] || db="$POSTGRES_USER"
    export PGCONNECT_TIMEOUT=5
    exec psql -X -A -t -q -w -v ON_ERROR_STOP=1 -h /var/run/postgresql -U "$POSTGRES_USER" -d "$db" -f -
  ' 2>&1)"; then
  rx=$'^SCHEMA_USAGE=(true|false)\nQUOTA_SELECT=(true|false)\nQUOTA_INSERT=(true|false)\nQUOTA_UPDATE=(true|false)$'
  if [[ "$sql_output" =~ $rx ]]; then
    printf '%s\n' "$sql_output"
    printf '%s\n' 'DB_GRANTS=inspected (configured database only)'
  else
    printf '%s\n' 'DB_GRANTS=untrusted_output_suppressed'
  fi
else
  printf '%s\n' 'DB_GRANTS=unavailable (raw error suppressed)'
fi

# Evaluate the *existing* certificate file; do not read or output its contents,
# filenames, paths, owner, subject, SAN, private key, or CA. OpenSSL hostname and
# 7-day validity are hints, never a substitute for a client verify-full handshake.
if cert_output="$(timeout 20 sudo -n docker exec --user postgres crc-postgres sh -eu -c '
  if ! command -v openssl >/dev/null 2>&1; then
    printf "CERT_TOOL=unavailable\n"
    exit 0
  fi
  cert="$(postgres -D /var/lib/postgresql/data -C ssl_cert_file 2>/dev/null || true)"
  [ -n "$cert" ] || { printf "CERT_FILE=unavailable\n"; exit 0; }
  case "$cert" in
    /*) path="$cert" ;;
    *) path="/var/lib/postgresql/data/$cert" ;;
  esac
  [ -r "$path" ] || { printf "CERT_FILE=unavailable\n"; exit 0; }
  printf "CERT_FILE=readable\n"
  if openssl x509 -noout -in "$path" -checkhost crc-postgres >/dev/null 2>&1; then
    printf "CERT_HOSTNAME_MATCH=yes\n"
  else
    printf "CERT_HOSTNAME_MATCH=no_or_invalid\n"
  fi
  if openssl x509 -noout -in "$path" -checkend 604800 >/dev/null 2>&1; then
    printf "CERT_VALID_7_DAYS=yes\n"
  else
    printf "CERT_VALID_7_DAYS=no_or_invalid\n"
  fi
' 2>&1)"; then
  cert_rx=$'^CERT_FILE=readable\nCERT_HOSTNAME_MATCH=(yes|no_or_invalid)\nCERT_VALID_7_DAYS=(yes|no_or_invalid)$'
  if [[ "$cert_output" =~ $cert_rx || "$cert_output" == 'CERT_TOOL=unavailable' || "$cert_output" == 'CERT_FILE=unavailable' ]]; then
    printf '%s\n' "$cert_output"
  else
    printf '%s\n' 'CERT_METADATA=untrusted_output_suppressed'
  fi
else
  printf '%s\n' 'CERT_METADATA=unavailable (raw errors suppressed)'
fi
printf '%s\n' 'TLS_VERIFY_FULL=not_tested; requires private DNS, a client-trusted CA and an actual TCP handshake'
printf '%s\n' 'No SQL writes, secrets, certs, network settings, ports, services or tunnels were changed.'
