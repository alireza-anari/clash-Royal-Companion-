#!/usr/bin/env bash
# Classify a failed read-only PostgreSQL catalog probe without revealing secrets.
# Does not change Docker, PostgreSQL, network settings, Cloudflare, or any service.
set -Eeuo pipefail
export LC_ALL=C

refuse() { printf 'REFUSED: %s\n' "$1" >&2; exit 1; }
[[ "$(id -un)" == ec2-user ]] || refuse 'run as ec2-user, without sudo on the script'
for cmd in sudo docker; do
  command -v "$cmd" >/dev/null 2>&1 || refuse "missing command: $cmd"
done

printf '%s\n' 'CRC PostgreSQL connection diagnosis: READ ONLY / REDACTED.'
if ! container="$(sudo -n docker inspect --format '{{.Config.Image}}|{{.State.Status}}|{{.State.Health.Status}}' crc-postgres 2>/dev/null)"; then
  refuse 'cannot inspect existing crc-postgres container'
fi
case "$container" in
  postgres:17\|running\|healthy) printf '%s\n' 'CONTAINER=postgres17_running_healthy' ;;
  *) printf '%s\n' 'CONTAINER=unexpected_state; no SQL attempted'; exit 2 ;;
esac

# Unix socket presence and a server readiness probe need no database password.
if sudo -n docker exec --user postgres crc-postgres test -S /var/run/postgresql/.s.PGSQL.5432 2>/dev/null; then
  printf '%s\n' 'UNIX_SOCKET=present'
else
  printf '%s\n' 'UNIX_SOCKET=missing_or_inaccessible'
fi

if sudo -n docker exec --user postgres crc-postgres pg_isready -q -h /var/run/postgresql -p 5432 2>/dev/null; then
  printf '%s\n' 'POSTGRES_ACCEPTING_CONNECTIONS=yes'
else
  printf '%s\n' 'POSTGRES_ACCEPTING_CONNECTIONS=no_or_unknown'
fi

# Read the effective server configuration without authenticating as a database user.
# Do NOT dump PGDATA contents, postgres config, Docker Env, or a raw error message.
server_ssl="$(sudo -n docker exec --user postgres crc-postgres postgres -D /var/lib/postgresql/data -C ssl 2>/dev/null || true)"
case "$server_ssl" in
  on) printf '%s\n' 'SERVER_SSL_CONFIG=on (certificate chain NOT verified)' ;;
  off) printf '%s\n' 'SERVER_SSL_CONFIG=off (beta TCP verify-full NOT ready)' ;;
  *) printf '%s\n' 'SERVER_SSL_CONFIG=unknown (review PGDATA path/config offline)' ;;
esac

# -w forbids an interactive password prompt. Capture stderr, classify it, never print it.
if auth_output="$(sudo -n docker exec --user postgres crc-postgres \
  psql -X -A -t -q -w -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -h /var/run/postgresql -c 'SELECT 1' 2>&1)"; then
  if [[ "$auth_output" == 1 ]]; then
    printf '%s\n' 'LOCAL_POSTGRES_ROLE_LOGIN=ok'
  else
    printf '%s\n' 'LOCAL_POSTGRES_ROLE_LOGIN=unexpected_response'
  fi
else
  case "$auth_output" in
    *'role "postgres" does not exist'*) reason=postgres_db_role_missing ;;
    *'database "postgres" does not exist'*) reason=maintenance_database_missing ;;
    *'Peer authentication failed'*) reason=peer_auth_rejected ;;
    *'password authentication failed'*) reason=password_auth_rejected ;;
    *'fe_sendauth: no password supplied'*) reason=password_required_not_supplied ;;
    *'permission denied'*) reason=filesystem_or_auth_permission_denied ;;
    *'connection to server'*'failed'*) reason=connection_failed ;;
    *) reason=unknown_auth_or_docker_error ;;
  esac
  printf 'LOCAL_POSTGRES_ROLE_LOGIN=%s\n' "$reason"
fi

printf '%s\n' 'No passwords, PGDATA, environment, raw database errors or DB records were printed.'
printf '%s\n' 'No SQL writes, Docker changes, database migrations or beta activation were performed.'
