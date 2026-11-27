#!/usr/bin/env bash
# CRC beta: read-only PostgreSQL role/password readiness and optional authentic
# TCP libpq verify-full probe from a disposable private-network client.
# --check (default): NO password prompt, only safe boolean server metadata.
# --verify: ask for the EXISTING crc_app password in the local terminal;
#           pipe it via stdin into an ephemeral client, never via Docker env,
#           CLI arguments, disk files, Docker inspect, Git or stdout.
# No SQL writes, role/password changes, services, tunnels or host port changes.
set -Eeuo pipefail
umask 077
export LC_ALL=C
set +x

readonly CA=/etc/crc-beta/trust/db-ca.crt
readonly PIN=a274759c3a0e05262625f95af35165aa6628fdf459f14958aefa13f68be60a56
readonly DB_CONTAINER=crc-postgres
readonly NETWORK=crc-private

refuse() { printf 'REFUSED: %s\n' "$1" >&2; exit 2; }
[[ "$(id -un)" == ec2-user ]] || refuse 'run as ec2-user, not root'
mode="${1:---check}"
[[ "$#" -le 1 && ( "$mode" == '--check' || "$mode" == '--verify' ) ]] ||
  refuse 'usage: probe-private-beta-db-auth.sh [--check|--verify]'
for command in sudo docker timeout openssl sed tr grep; do
  command -v "$command" >/dev/null 2>&1 || refuse "missing prerequisite: $command"
done

printf '%s\n' 'CRC private beta DB auth: READ-ONLY / REDACTED.'
if ! sudo -n test -f "$CA" >/dev/null 2>&1 ||
   ! sudo -n test ! -L "$CA" >/dev/null 2>&1 ||
   ! sudo -n test -r "$CA" >/dev/null 2>&1; then
  refuse 'reviewed public CA is missing or unavailable'
fi
ca_fingerprint="$(sudo -n openssl x509 -in "$CA" -noout -fingerprint -sha256 2>/dev/null |
  sed -n 's/^sha256 Fingerprint=//p' | tr -d ':' | tr 'A-F' 'a-f')"
[[ "$ca_fingerprint" == "$PIN" ]] || refuse 'public CA fingerprint differs from reviewed pin'
meta="$(sudo -n docker inspect --format '{{.Config.Image}}|{{.State.Status}}|{{.State.Health.Status}}|{{.HostConfig.NetworkMode}}' "$DB_CONTAINER" 2>/dev/null)" ||
  refuse 'existing PostgreSQL container unavailable'
[[ "$meta" == 'postgres:17|running|healthy|crc-private' ]] ||
  refuse 'PostgreSQL container differs from reviewed configuration'
network="$(sudo -n docker network inspect --format '{{.Driver}}|{{.Internal}}' "$NETWORK" 2>/dev/null)" ||
  refuse 'Docker network metadata unavailable'
[[ "$network" == 'bridge|true' ]] ||
  refuse 'expected internal Docker bridge network'
if published="$(sudo -n docker port "$DB_CONTAINER" 5432/tcp 2>/dev/null)" &&
   [[ -n "$published" ]]; then
  refuse 'PostgreSQL port unexpectedly published on host'
fi

# Fixed catalog SELECT. The configured bootstrap role/database are expanded
# INSIDE the existing DB container, not printed, copied to Git or logged.
catalog_query="SELECT 'CRC_APP_PASSWORD_CONFIGURED=' || (EXISTS
    (SELECT 1 FROM pg_authid
     WHERE rolname = 'crc_app' AND rolcanlogin AND rolpassword IS NOT NULL))::text;
  SELECT 'CRC_APP_ROLE_LOGIN=' || COALESCE((
    SELECT rolcanlogin::text FROM pg_roles WHERE rolname = 'crc_app'
  ), 'absent');
  SELECT 'CRC_APP_DB_CONNECT=' || (EXISTS(
    SELECT 1 FROM pg_roles WHERE rolname='crc_app'
  ) AND has_database_privilege('crc_app', current_database(), 'CONNECT'))::text;"
if metadata="$(printf '%s\n' "$catalog_query" |
  timeout 20 sudo -n docker exec -i --user postgres "$DB_CONTAINER" \
    env -u PGPASSWORD -u PGUSER -u PGDATABASE -u PGHOST -u PGSERVICE \
    sh -eu -c '
      [ -n "${POSTGRES_USER:-}" ] || exit 8
      database="${POSTGRES_DB:-$POSTGRES_USER}"
      exec psql -X -A -t -q -w -v ON_ERROR_STOP=1 \
        -h /var/run/postgresql -U "$POSTGRES_USER" -d "$database" -f -
    ' 2>&1)"; then
  # Capture only the three expected booleans. Never echo raw SQL results
  # (which could include hashes, role names or unexpected server diagnostics).
  declare -A fields=()
  valid=1
  while IFS= read -r line; do
    case "$line" in
      CRC_APP_PASSWORD_CONFIGURED=true|CRC_APP_PASSWORD_CONFIGURED=false|\
      CRC_APP_ROLE_LOGIN=true|CRC_APP_ROLE_LOGIN=false|CRC_APP_ROLE_LOGIN=absent|\
      CRC_APP_DB_CONNECT=true|CRC_APP_DB_CONNECT=false)
        key="${line%%=*}"
        [[ -z "${fields[$key]+set}" ]] || valid=0
        fields[$key]="${line#*=}"
        ;;
      *) valid=0 ;;
    esac
  done <<< "$metadata"
  for key in CRC_APP_PASSWORD_CONFIGURED CRC_APP_ROLE_LOGIN CRC_APP_DB_CONNECT; do
    [[ -n "${fields[$key]+set}" ]] || valid=0
  done
  if [[ "$valid" == 1 ]]; then
    for key in CRC_APP_PASSWORD_CONFIGURED CRC_APP_ROLE_LOGIN CRC_APP_DB_CONNECT; do
      printf '%s=%s\n' "$key" "${fields[$key]}"
    done
  else
    printf '%s\n' 'CRC_APP_READINESS=unknown (unexpected output suppressed)'
  fi
else
  printf '%s\n' 'CRC_APP_READINESS=unknown (database catalog failure suppressed)'
fi

if [[ "$mode" == --check ]]; then
  printf '%s\n' 'CRC_APP_AUTH=not_tested (run --verify only if the existing password is available)'
  printf '%s\n' 'No credentials read, database rows changed, ports or services modified.'
  exit 0
fi

# Verify the exact existing configured database without showing its name.
# The name is not a password, but keep it out of diagnostics and allow only
# simple Postgres database identifiers to avoid surprises in process arguments.
database="$(timeout 15 sudo -n docker exec --user postgres "$DB_CONTAINER" \
  sh -eu -c '[ -n "${POSTGRES_USER:-}" ] || exit 1; printf %s "${POSTGRES_DB:-$POSTGRES_USER}"' 2>/dev/null)" ||
  refuse 'configured database name could not be read securely'
[[ "$database" =~ ^[A-Za-z_][A-Za-z0-9_-]{0,62}$ ]] ||
  refuse 'configured database name requires manual review'
sudo -n docker image inspect postgres:17 >/dev/null 2>&1 ||
  refuse 'existing PostgreSQL client image unavailable; will not pull'

[[ -r /dev/tty ]] || refuse 'an interactive EC2 terminal is required (not chat)'
printf '%s' 'Existing crc_app database password (hidden; do not paste into chat): ' >/dev/tty
secret=''
if ! IFS= read -r -s secret </dev/tty; then
  printf '\n' >/dev/tty
  refuse 'password was not supplied'
fi
printf '\n' >/dev/tty
[[ -n "$secret" ]] || refuse 'empty password; verification not attempted'
trap 'unset secret' EXIT

# Password travels ONLY over temporary Docker client stdin and is exported
# INSIDE that running container immediately before psql. It is NEVER a
# docker --env value, command-line argument, PG passfile, or EC2 disk file.
# PGOPTIONS enforces read-only transactions even if SQL later changes.
if result="$(
  printf '%s\n' "$secret" |
  timeout 35 sudo -n docker run --rm -i --pull never \
    --network "$NETWORK" --read-only --user 10001:10001 \
    --cap-drop ALL --pids-limit 48 --memory 128m \
    --security-opt no-new-privileges \
    --env PGSSLMODE=verify-full \
    --env PGSSLROOTCERT=/run/crc-beta/db-ca/ca.crt \
    --env PGOPTIONS='-c default_transaction_read_only=on' \
    --env PGCONNECT_TIMEOUT=5 \
    --mount "type=bind,src=$CA,dst=/run/crc-beta/db-ca/ca.crt,readonly" \
    --entrypoint sh postgres:17 -eu -c '
      test -r /run/crc-beta/db-ca/ca.crt
      IFS= read -r PGPASSWORD || exit 86
      [ -n "$PGPASSWORD" ] || exit 87
      export PGPASSWORD
      exec psql -X -A -t -q -w -v ON_ERROR_STOP=1 \
        -h crc-postgres -p 5432 -U crc_app -d "$1" -c "
        SELECT CASE WHEN
          current_user = '\''crc_app'\''
          AND current_setting('\''transaction_read_only'\'') = '\''on'\''
          AND (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid())
          AND has_schema_privilege('\''public'\'','\''USAGE'\'')
          AND has_table_privilege('\''public.gateway_quota_windows'\'','\''SELECT'\'')
          AND has_table_privilege('\''public.gateway_quota_windows'\'','\''INSERT'\'')
          AND has_table_privilege('\''public.gateway_quota_windows'\'','\''UPDATE'\'')
        THEN '\''CRC_APP_AUTH=verified_read_only_tls_and_grants'\''
        ELSE '\''CRC_APP_AUTH=policy_incomplete'\''
        END;
        "
    ' -- "$database" 2>&1
)"; then
  # A successful psql exit is insufficient; whitelist the ONLY valid output.
  case "$result" in
    'CRC_APP_AUTH=verified_read_only_tls_and_grants'|'CRC_APP_AUTH=policy_incomplete')
      printf '%s\n' "$result" ;;
    *) printf '%s\n' 'CRC_APP_AUTH=untrusted_output_suppressed'; exit 2 ;;
  esac
else
  # Classify diagnostic text IN MEMORY; never print its raw contents. The
  # old script reduced every psql/client failure to a single ambiguous error.
  # A failure class is evidence, not proof that a particular password was used.
  case "$result" in
    *'password authentication failed'*|*'no password supplied'*)
      category=password_rejected ;;
    *'certificate verify failed'*|*'certificate verification failed'*|*'root certificate file'*|*'server certificate'*)
      category=certificate_rejected ;;
    *'could not translate host name'*|*'Connection refused'*|*'timeout expired'*|*'could not connect to server'*)
      category=network_or_dns_unavailable ;;
    *'database '*' does not exist'*|*'role '*' does not exist'*)
      category=database_or_role_unavailable ;;
    *'ERROR:'*)
      category=sql_or_grant_error ;;
    *)
      category=unclassified ;;
  esac
  printf 'CRC_APP_AUTH=%s (raw errors suppressed)\n' "$category"
  exit 2
fi
printf '%s\n' 'No database writes, password files, service changes, published ports, or beta activation.'
