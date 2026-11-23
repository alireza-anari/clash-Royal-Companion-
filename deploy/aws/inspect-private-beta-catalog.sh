#!/usr/bin/env bash
# Read-only, redacted metadata probe using PostgreSQL's configured bootstrap role.
# Credentials and role/database names are used inside the container, NEVER printed.
# Does not start services, change authentication, write SQL, or expose ports.
set -Eeuo pipefail
export LC_ALL=C
umask 077

refuse() { printf 'REFUSED: %s\n' "$1" >&2; exit 1; }
[[ "$(id -un)" == ec2-user ]] || refuse 'run as ec2-user (no sudo prefix)'
for tool in sudo docker timeout; do
  command -v "$tool" >/dev/null 2>&1 || refuse "missing command: $tool"
done
printf '%s\n' 'CRC PostgreSQL configured-role catalog check: READ ONLY / REDACTED.'

# Check ONLY the named existing container and three non-secret fields.
if ! meta="$(sudo -n docker inspect --format '{{.Config.Image}}|{{.State.Status}}|{{.State.Health.Status}}' crc-postgres 2>/dev/null)"; then
  refuse 'crc-postgres is missing or Docker is unavailable'
fi
[[ "$meta" == 'postgres:17|running|healthy' ]] || refuse 'unexpected PostgreSQL image or health; no SQL attempted'

# A Unix socket is not a TLS connection, and this probe cannot validate verify-full.
# POSTGRES_USER/POSTGRES_DB are expanded ONLY by the container shell.
# Never dump Docker Config.Env, PostgreSQL variables, stderr, database rows or user names.
# Unset libpq variables that could introduce credentials or redirect the connection.
# psql -w prevents a password prompt; all results are fixed booleans or static markers.
if output="$(timeout 20 sudo -n docker exec --user postgres crc-postgres \
  env -u PGPASSWORD -u PGUSER -u PGDATABASE -u PGHOST -u PGSERVICE \
  sh -eu -c '
    if [ -z "${POSTGRES_USER:-}" ]; then
      printf "CRC_CONFIGURED_DB_ROLE_ENV_MISSING\n"
      exit 5
    fi
    selected_db="${POSTGRES_DB:-$POSTGRES_USER}"
    export PGCONNECT_TIMEOUT=5
    exec psql -X -A -t -q -w -v ON_ERROR_STOP=1 \
      -h /var/run/postgresql -U "$POSTGRES_USER" -d "$selected_db" -c "
        SELECT '\''DB_ACCESSIBLE=yes'\'';
        SELECT '\''SERVER_SSL='\'' || current_setting('\''ssl'\'');
        SELECT '\''CRC_APP_ROLE_PRESENT='\'' ||
          (EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '\''crc_app'\'') )::text;
        SELECT '\''CRC_APP_ROLE_LOGIN='\'' ||
          COALESCE((SELECT rolcanlogin::text FROM pg_roles WHERE rolname = '\''crc_app'\''), '\''absent'\'');
        SELECT '\''CRC_APP_ROLE_SUPERUSER='\'' ||
          COALESCE((SELECT rolsuper::text FROM pg_roles WHERE rolname = '\''crc_app'\''), '\''absent'\'');
        SELECT '\''GATEWAY_QUOTA_TABLE_PRESENT='\'' ||
          (to_regclass('\''public.gateway_quota_windows'\'') IS NOT NULL)::text;
        SELECT '\''AI_QUOTA_TABLE_PRESENT='\'' ||
          (to_regclass('\''public.ai_daily_quota_windows'\'') IS NOT NULL)::text;
      "
  ' 2>&1)"; then
  # Treat ALL output as untrusted until every line and every expected key is validated.
  declare -A fields=()
  invalid=0
  while IFS= read -r line; do
    case "$line" in
      DB_ACCESSIBLE=yes|SERVER_SSL=on|SERVER_SSL=off|CRC_APP_ROLE_PRESENT=true|CRC_APP_ROLE_PRESENT=false|CRC_APP_ROLE_LOGIN=true|CRC_APP_ROLE_LOGIN=false|CRC_APP_ROLE_LOGIN=absent|CRC_APP_ROLE_SUPERUSER=true|CRC_APP_ROLE_SUPERUSER=false|CRC_APP_ROLE_SUPERUSER=absent|GATEWAY_QUOTA_TABLE_PRESENT=true|GATEWAY_QUOTA_TABLE_PRESENT=false|AI_QUOTA_TABLE_PRESENT=true|AI_QUOTA_TABLE_PRESENT=false)
        key="${line%%=*}"
        if [[ -n "${fields[$key]+present}" ]]; then invalid=1; fi
        fields[$key]="${line#*=}"
        ;;
      *) invalid=1 ;;
    esac
  done <<< "$output"
  for key in DB_ACCESSIBLE SERVER_SSL CRC_APP_ROLE_PRESENT CRC_APP_ROLE_LOGIN CRC_APP_ROLE_SUPERUSER GATEWAY_QUOTA_TABLE_PRESENT AI_QUOTA_TABLE_PRESENT; do
    [[ -n "${fields[$key]+present}" ]] || invalid=1
  done
  if [[ "$invalid" == 0 ]]; then
    for key in DB_ACCESSIBLE SERVER_SSL CRC_APP_ROLE_PRESENT CRC_APP_ROLE_LOGIN CRC_APP_ROLE_SUPERUSER GATEWAY_QUOTA_TABLE_PRESENT AI_QUOTA_TABLE_PRESENT; do
      printf '%s=%s\n' "$key" "${fields[$key]}"
    done
    printf '%s\n' 'CATALOG_PROBE=success (local socket only; TLS verify-full NOT verified)'
  else
    printf '%s\n' 'CATALOG_PROBE=unexpected_or_unsafe_output (suppressed)'
  fi
else
  case "$output" in
    *CRC_CONFIGURED_DB_ROLE_ENV_MISSING*) code=bootstrap_role_env_not_set ;;
    *'password authentication failed'*) code=password_auth_rejected ;;
    *'Peer authentication failed'*) code=peer_auth_rejected ;;
    *'fe_sendauth: no password supplied'*) code=password_required_not_supplied ;;
    *'does not exist'*) code=configured_role_or_database_missing ;;
    *'connection to server'*'failed'*) code=socket_connection_failed ;;
    *) code=unknown_auth_or_permission_failure ;;
  esac
  printf 'CATALOG_PROBE=%s (raw errors suppressed)\n' "$code"
fi

printf '%s\n' 'No database names, configured role names, passwords, raw errors or records printed.'
printf '%s\n' 'No SQL writes, Docker changes, credentials, tunnels or beta activation.'
