#!/usr/bin/env bash
# Read-only metadata inventory of existing CRC PostgreSQL container.
# Never show environment variables, passwords, DSNs, SQL table contents, or Docker inspect JSON.
set -Eeuo pipefail
umask 077

refuse() { printf 'REFUSED: %s\n' "$1" >&2; exit 1; }
[[ "$(id -un)" == ec2-user ]] || refuse 'run as ec2-user without sudo on the script'
for tool in sudo docker ss; do
  command -v "$tool" >/dev/null 2>&1 || refuse "missing command: $tool"
done

printf '%s\n' 'CRC PostgreSQL beta preflight: READ ONLY; no DB writes or service changes.'

# Explicitly inspect only metadata fields, NEVER .Config.Env, mounts, or container logs.
if ! status="$(sudo -n docker inspect --format 'image={{.Config.Image}};state={{.State.Status}};health={{.State.Health.Status}};network={{.HostConfig.NetworkMode}}' crc-postgres 2>/dev/null)"; then
  refuse 'cannot inspect crc-postgres (container missing or Docker access denied)'
fi
printf 'container: %s\n' "$status"

if mapped="$(sudo -n docker port crc-postgres 5432/tcp 2>/dev/null)" && [[ -n "$mapped" ]]; then
  printf '%s\n' 'WARNING: PostgreSQL container has a published host TCP port:'
  printf '%s\n' "$mapped"
else
  printf '%s\n' 'PostgreSQL container: no published host port 5432/tcp reported'
fi

if host_db_listener="$(ss -H -ltn '( sport = :5432 )' 2>/dev/null)"; then
  if [[ -n "$host_db_listener" ]]; then
    printf '%s\n' 'Host: TCP listener on port 5432 observed; inspect exposure separately'
  else
    printf '%s\n' 'Host: no TCP listener on port 5432 observed'
  fi
else
  printf '%s\n' 'Host: unable to verify port 5432'
fi

# PostgreSQL metadata only. A Unix-socket session is NOT a TLS verification.
# The 'postgres' maintenance database is not necessarily the future beta database.
# A failed login is only an inventory limitation, not permission to bypass auth.
if result="$(sudo -n docker exec --user postgres crc-postgres \
    psql -X -A -t -q -v ON_ERROR_STOP=1 -U postgres -d postgres -c "
      SELECT 'server_version_major=' || (current_setting('server_version_num')::integer / 10000)::text;
      SELECT 'server_ssl_enabled=' || current_setting('ssl');
      SELECT 'crc_app_role_present=' || (EXISTS (SELECT 1 FROM pg_roles WHERE rolname='crc_app'))::text;
      SELECT 'postgres_db_gateway_quota_table_present=' ||
        (to_regclass('public.gateway_quota_windows') IS NOT NULL)::text;
      SELECT 'postgres_db_ai_daily_quota_table_present=' ||
        (to_regclass('public.ai_daily_quota_windows') IS NOT NULL)::text;
    " 2>/dev/null)"; then
  printf '%s\n' "$result"
else
  printf '%s\n' 'Metadata SQL: unavailable (auth/socket/permissions); no credentials requested'
fi

printf '%s\n' 'No SQL writes, migrations, new databases, users, services, ports, or Cloudflare changes.'
printf '%s\n' 'NEXT: review TLS verify-full, least-privilege database, quota migrations, and secrets before activation.'
