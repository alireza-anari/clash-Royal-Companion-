#!/usr/bin/env bash
# CI ONLY: disposable PostgreSQL 17 + disposable CA + independent verified client.
# No production CA, DB data, cloud credentials, Supercell, AI, or public ports.
set -Eeuo pipefail
umask 077

for command in docker openssl mktemp timeout; do
  command -v "$command" >/dev/null 2>&1 || { echo "Missing CI tool: $command"; exit 1; }
done
scratch="$(mktemp -d)"
network="crc-ci-private-tls-$$"
postgres="crc-ci-postgres-$$"
cleanup() {
  docker rm -f "$postgres" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  rm -rf -- "$scratch"
}
trap cleanup EXIT

# Entirely disposable test-only keys, never committed or printed.
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -sha256 \
  -subj "/CN=CRC CI disposable CA" \
  -addext "basicConstraints=critical,CA:TRUE" \
  -addext "keyUsage=critical,keyCertSign,cRLSign" \
  -keyout "$scratch/ca.key" -out "$scratch/ca.crt" >/dev/null 2>&1
openssl req -newkey rsa:2048 -nodes -sha256 \
  -subj "/CN=crc-postgres" \
  -keyout "$scratch/server.key" -out "$scratch/server.csr" >/dev/null 2>&1
cat > "$scratch/server.ext" <<'EOF'
basicConstraints=critical,CA:FALSE
subjectAltName=DNS:crc-postgres
extendedKeyUsage=serverAuth
keyUsage=digitalSignature,keyEncipherment
EOF
openssl x509 -req -in "$scratch/server.csr" -CA "$scratch/ca.crt" \
  -CAkey "$scratch/ca.key" -CAcreateserial -days 2 -sha256 \
  -extfile "$scratch/server.ext" -out "$scratch/server.crt" >/dev/null 2>&1
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -sha256 \
  -subj "/CN=unrelated CI root" \
  -addext "basicConstraints=critical,CA:TRUE" \
  -keyout "$scratch/unrelated.key" -out "$scratch/unrelated-ca.crt" >/dev/null 2>&1

# The PostgreSQL image runs as uid/gid "postgres"; only the server key is
# mounted into that ephemeral container. Never mount the disposable CA key.
pg_uid="$(docker run --rm --entrypoint id postgres:17 -u postgres)"
pg_gid="$(docker run --rm --entrypoint id postgres:17 -g postgres)"
chmod 0600 "$scratch/server.key"
chmod 0755 "$scratch"
chmod 0644 "$scratch/server.crt" "$scratch/ca.crt" "$scratch/unrelated-ca.crt"
sudo chown "$pg_uid:$pg_gid" "$scratch/server.key"

docker network create --internal "$network" >/dev/null
docker run --detach --name "$postgres" \
  --network "$network" --network-alias crc-postgres --network-alias wrong-postgres \
  --env POSTGRES_USER=crc_app \
  --env POSTGRES_PASSWORD=disposable-ci-password \
  --env POSTGRES_DB=crc_tls_test \
  --mount "type=bind,src=$scratch/server.key,dst=/run/ci-server.key,readonly" \
  --mount "type=bind,src=$scratch/server.crt,dst=/run/ci-server.crt,readonly" \
  postgres:17 -c ssl=on -c ssl_cert_file=/run/ci-server.crt -c ssl_key_file=/run/ci-server.key >/dev/null

ready=false
for attempt in $(seq 1 45); do
  if docker exec "$postgres" pg_isready -q -h 127.0.0.1 -U crc_app -d crc_tls_test >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
[[ "$ready" == true ]] || { echo "Disposable PostgreSQL is not ready"; exit 1; }

run_psql() {
  local ca_file="$1" host="$2"
  docker run --rm --pull never \
    --network "$network" --read-only --user 10001:10001 \
    --cap-drop ALL --security-opt no-new-privileges \
    --mount "type=bind,src=$ca_file,dst=/run/crc-beta/db-ca/ca.crt,readonly" \
    --env PGPASSWORD=disposable-ci-password \
    --entrypoint psql postgres:17 \
    "host=$host port=5432 user=crc_app dbname=crc_tls_test sslmode=verify-full sslrootcert=/run/crc-beta/db-ca/ca.crt connect_timeout=5" \
    -X -A -t -q -c 'SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()'
}

result="$(run_psql "$scratch/ca.crt" crc-postgres)"
[[ "$result" == t ]] || { echo "verify-full independent client did not negotiate TLS"; exit 1; }
echo "LIBPQ_VERIFY_FULL=success_with_disposable_CI_CA"

if run_psql "$scratch/ca.crt" wrong-postgres >/dev/null 2>&1; then
  echo "FAIL: verify-full accepted the wrong hostname"
  exit 1
fi
echo "LIBPQ_BAD_HOSTNAME=denied"

if run_psql "$scratch/unrelated-ca.crt" crc-postgres >/dev/null 2>&1; then
  echo "FAIL: verify-full accepted an unrelated CA"
  exit 1
fi
echo "LIBPQ_WRONG_CA=denied"

# Run actual beta asyncpg configuration against the same PostgreSQL from an
# independently built image, with the disposable CI CA substituted only inside
# this explicit test process. The production CA fingerprint is not changed.
docker build --file deploy/docker/Dockerfile.beta --tag crc-private-beta-ci-tls . >/dev/null
docker run --rm --pull never \
  --network "$network" --read-only --user 10001:10001 \
  --cap-drop ALL --security-opt no-new-privileges \
  --mount "type=bind,src=$scratch/ca.crt,dst=/run/crc-beta/db-ca/ca.crt,readonly" \
  --env 'CRC_TEST_TLS_DSN=postgresql://crc_app:disposable-ci-password@crc-postgres:5432/crc_tls_test?sslmode=verify-full&sslrootcert=/run/crc-beta/db-ca/ca.crt' \
  --entrypoint python crc-private-beta-ci-tls -c '
import asyncio
from cryptography import x509
from cryptography.hazmat.primitives import hashes
from pathlib import Path
import asyncpg
import crc_api.beta_db_tls as tls

public_ca = x509.load_pem_x509_certificate(Path(tls.BETA_CA_PATH).read_bytes())
tls.REVIEWED_CA_SHA256 = public_ca.fingerprint(hashes.SHA256()).hex()  # TEST ONLY

async def check():
    import os
    dsn = os.environ["CRC_TEST_TLS_DSN"]
    context = tls.verified_beta_ssl_context(dsn)
    conn = await asyncpg.connect(dsn=dsn, ssl=context, timeout=6)
    try:
        assert await conn.fetchval("SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()") is True
    finally:
        await conn.close()
asyncio.run(check())
print("BETA_ASYNCPG_VERIFY_FULL=success_with_disposable_CI_CA")
'
echo "All disposable private beta TLS checks passed, no production infrastructure contacted."
