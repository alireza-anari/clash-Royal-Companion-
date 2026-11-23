# SP-BETA-05 — Private beta deployment, health, and emergency rollback

**Verified status (22 November 2026): the distinct private beta Worker is deployed with 14 static assets and a VPC Service binding, but it is intentionally disabled. The VPC Tunnel has no active connector; the separate FastAPI beta service is not installed; invite/HMAC secrets are not configured; AWS OIDC automation is not connected. No live Supercell or AI calls are enabled.**

The public sample Worker remains separate and unchanged. `main` is untouched. No Zero Trust payment setup is required for this invite-only Workers VPC path.

## 1. What is deployed

- Worker script: `crc-private-beta-gateway`.
- Hostname: `crc-private-beta-gateway.alirezaanari117.workers.dev`; previews disabled.
- Static assets: 14 files, attached with `ASSETS`.
- Plain-text switches: `BETA_ENABLED=false`, `BETA_AI_CHAT_ENABLED=false`; exact hostname, issuer and audience are pinned.
- `PRIVATE_API` binding: attached to VPC Service `crc-private-beta-api`, ID `01a202d5-1889-72d3-9a12-4a2838612589`.
- VPC Service destination: `127.0.0.1:8001` (retargeted on 23 November 2026), through Cloudflare Tunnel ID `45520fe5-2670-417e-8f8e-932c60821aa6`.
- Verified Worker response while off: HTTP 503, error code `BETA_NOT_CONFIGURED`.

The Worker deployment is a safe, non-live edge shell. It does not prove that the origin is reachable or that a browser session can authenticate.

## 2. Current blockers before a real private request

1. **AWS automation:** the read-only OIDC and backend-sync workflows are skipped because `AWS_CRC_OIDC_ROLE_ARN`, `AWS_CRC_BACKEND_SYNC_ROLE_ARN` and/or `CRC_BACKEND_AUTOSYNC` are not configured. The existing EC2 pull timer only updates a Git checkout; it does not run SSM, install a service or restart containers.
2. **Tunnel connector:** the Cloudflare Tunnel has no active connection. Its prior Docker container was stopped. The old bridge network cannot reach host loopback. Recreate the connector with `--network host` (or another reviewed route) so its configured `127.0.0.1:8001` target reaches the host's beta service.
3. **Backend service:** `crc-private-beta.service` was not installed at the last readiness check. The running local-only app is not the beta gateway and occupies `127.0.0.1:8000`; it must remain intact. The beta template and private VPC Service now both target `127.0.0.1:8001` (still no beta process).
4. **Secret injection:** create separate random Worker session/assertion HMAC keys and invite-code hash map in Worker Secrets. Inject the matching assertion key, separate quota HMAC key, invited subject allowlist and PostgreSQL DSN into the backend from AWS SSM. Do not store any of these in GitHub.
5. **Database and runtime:** preserve verified PostgreSQL TLS, least-privilege `crc_app`, quota migration and cleanup timer. Install the beta runtime with its exact explicit owner-approval gate unset until the final review.
6. **End-to-end tests:** verify real invite login, cookie flags, logout/expiry, Worker assertion verification, quota reservation, private VPC reachability and unauthorized denial. Do not call Supercell during these tests.

## 3. Deployment order — not yet executed

1. Complete the one-time AWS GitHub OIDC IAM bootstrap and add the exact role ARN repository variable. Use the read-only workflow first. Then configure a separate, narrowly scoped backend-sync role only if needed.
2. Use SSM Session Manager (not SSH or a public inbound port) to inspect the instance and apply the reviewed backend deployment. Keep all secrets in SSM/host-protected files. Keep the local API process on port 8000 untouched while staging the separate beta process on 8001, with a reviewed rollback.
3. Recreate `cloudflared` on host networking with the existing token file and no published ports; verify Cloudflare reports an active connector. Do not expose ports 8000 or 8001 in the security group.
4. Confirm the VPC Service points to the actual beta gateway on localhost. Run a private-origin connectivity check without enabling the public Worker.
5. Configure the three Worker Secrets and matching backend SSM parameters; add only opaque subject IDs to the backend allowlist.
6. Validate all automated tests and the protected readiness route. Keep `BETA_ENABLED=false`, `BETA_AI_CHAT_ENABLED=false` and `CRC_BETA_LIVE_LOOKUP_ENABLED=false` until the owner approves the final activation review.
7. Only after approval, enable invite-only beta access. Live Supercell lookup and online AI remain separate switches requiring their own review.

## 4. Offline preflight

The committed example manifest remains disabled and must stay that way:

```sh
python -m crc_api.release_preflight deploy/release/beta-manifest.example.json --mode lint
python -m crc_api.release_preflight deploy/release/beta-manifest.example.json --mode require-disabled
python -m crc_api.release_preflight deploy/release/beta-manifest.example.json --mode preflight
python -m crc_api.release_preflight deploy/release/beta-manifest.example.json --mode rollback
```

These checks do not deploy, call AWS/Cloudflare, read secrets or change runtime switches.

## 5. Emergency stop

- Fast edge stop: set `BETA_ENABLED=false` on the distinct private Worker. This must never change the public sample Worker.
- Independent backend stop: set `CRC_BETA_LIVE_LOOKUP_ENABLED=false` and restart the private backend.
- AI stop: set `BETA_AI_CHAT_ENABLED=false` and `CRC_BETA_AI_ENABLED=false`.
- Identity incident: remove affected invite-code hashes and rotate the session and assertion HMAC keys. Rotation invalidates current sessions/assertions.
- Do not roll back PostgreSQL quota migrations automatically. Preserve audit and quota protections.
- Reactivation requires owner approval, fresh tests, a verified private origin and a new release review.

## 6. Current verified test evidence

- Backend CI: 219 passed, 1 warning.
- Frontend/edge CI: 84 passed.
- Private Worker deploy CI: successful; disabled-state probe returned `503 BETA_NOT_CONFIGURED`.
- No actual AWS service restart, SSM secret injection, Tunnel connection, private API request, invite login or Supercell call has been performed.

## References

- Workers VPC pricing: https://developers.cloudflare.com/workers-vpc/platform/pricing/
- VPC Services: https://developers.cloudflare.com/workers-vpc/configuration/vpc-services/
- Workers Binding API: https://developers.cloudflare.com/workers-vpc/api/
- AWS Systems Manager Session Manager: https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager.html
- GitHub Actions OIDC for AWS: https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws

## Update — 23 November 2026: preserve the running local API

Operator read-only EC2 probe reported `crc-local-api.service` active, `crc-private-beta.service` not found, `cloudflared.service` not found, a TCP listener on port 8000, and no discoverable running cloudflared Docker container. The probe did **not** establish which process owns port 8000. A separate Cloudflare API check confirms the existing `crc-aws-private` Tunnel is **down**, with zero connections. This is not an active beta.

**New staged, source-only decision:** keep the existing local API on `127.0.0.1:8000` intact and reserve `127.0.0.1:8001` as the candidate private-beta origin. The review-only systemd template now uses port 8001; nothing has been installed or started. The read-only EC2 diagnostic checks whether port 8001 is occupied.

**Resolved destination mismatch (23 November 2026):** the separate `crc-private-beta-api` Cloudflare VPC Service was changed through the Cloudflare API from `127.0.0.1:8000` to `127.0.0.1:8001`. The updated service was read back successfully. Worker `BETA_ENABLED=false`, `BETA_AI_CHAT_ENABLED=false`, and the Tunnel remained down. This is **not** a functional private beta; backend provisioning, secrets, database quotas and protected routing are still pending.

Next actions, in order:

1. Allow CI-gated GitHub-to-EC2 checkout sync to finish; inspect output of `bash /opt/clash-royale-companion/backend-github/deploy/aws/check-private-beta-path.sh`. This changes nothing on the instance. Port 8001 must not already be in use.
2. Review service package/OS user, separate host-only network binding, TLS-verified PostgreSQL, installed quota migrations, secrets and rollback before preparing the beta runtime. The existing local service must keep running.
3. Before activating the Tunnel, prove that port 8001 serves the *correct, authenticated* beta app; VPC Service already targets that port. Verify the cloudflared connector reaches host loopback without public EC2 inbound ports; a disconnected Tunnel by itself proves no connectivity.
4. Test login, expiry, issuer/audience/HMAC checks, quota enforcement and shutdown paths without Supercell or OpenRouter calls. Obtain product-owner approval before setting any runtime gate or switching the private Worker on.

Until then, keep `BETA_ENABLED=false`, `BETA_AI_CHAT_ENABLED=false`, `CRC_BETA_LIVE_LOOKUP_ENABLED=false` and the backend activation marker unset. The sample-only frontend and `main` remain unaffected.

## Update — 23 November 2026: separate Python 3.12 staging on EC2

The EC2 operator reported Python 3.12.16 (Python 3.9 is also present), approximately 17 GiB available on the root filesystem, and no local TCP listeners on ports 8001 or 5432. Port 8000 was observed listening on loopback as a Python process. Port 5432 not listening locally **does not establish that PostgreSQL is absent**; it may be in Docker without a published port or on another host. Do not create or migrate a database based on this output alone.

CI-gated source-only script `deploy/aws/stage-private-beta-python.sh` stages the tracked `api/` source from `/opt/clash-royale-companion/backend-github` into a revision-specific, private directory in `/home/ec2-user/crc-beta-staging/`. As `ec2-user` (not sudo), it checks source branch/origin/clean worktree, Python 3.12, minimum 1 GiB free, and that port 8001 is unused; it creates a dedicated Python 3.12 virtual environment, downloads/install packages from PyPI with the `[security]` extra, checks dependencies and imports, and verifies the runtime gate fails closed when unset.

**This is a source and dependencies staging operation, not a deployment:** it does not install systemd units, start an API, alter the current `crc-local-api`, change AWS resources or PostgreSQL, connect Tunnel, configure secrets, or enable Cloudflare/AI/Supercell. It does use disk space and outbound package-download traffic; monitor AWS Free Plan credits. The staging environment under the ec2-user home is **not** the final hardened `/opt/crc-beta` service directory, and must not be used directly by a privileged service.

Run only after the corresponding GitHub backend CI is green and the EC2 code sync timer has fetched the revision:

```bash
bash /opt/clash-royale-companion/backend-github/deploy/aws/stage-private-beta-python.sh
```

Expected: `STAGED SUCCESSFULLY: <40-character SHA>`, `Private beta config gate: CLOSED (expected)`, and explicit confirmation that no service started. If it refuses, inspect the message rather than bypassing a guard. Do not paste secret values or `.env` files. For database inventory, inspect container names/images/status only (not container environments or connection strings) before planning TLS-backed quota setup.

## Update — 23 November 2026: staged Python and healthy PostgreSQL container

Operator reported successful `stage-private-beta-python.sh` execution on revision `e17b19cff75197e2ab49e88899cb291910c5e382`: Python 3.12 private virtual environment built, pip dependency check successful, and `Private beta config gate: CLOSED (expected)`; no unit or port started. Reported `docker ps` shows `crc-postgres` running image `postgres:17` and healthy for 36 hours. This does **not** verify a TLS-enabled PostgreSQL service, a scoped application DB role, schema migrations, private network reachability, or credentials.

Next stage is a **read-only** inspection using `deploy/aws/inspect-private-beta-postgres.sh`. The script uses selected Docker metadata fields (never full Docker JSON or `.Config.Env`) and queries PostgreSQL settings/catalog from the `postgres` maintenance database through a local container socket. It reports server SSL enabled/disabled, existence of an application role and candidate quota tables *in that maintenance database*, and whether port 5432 is published; it does not expose secrets or execute SQL writes. If socket authentication fails, the script reports an unknown state without asking for a password. Presence/absence of tables in `postgres` says nothing conclusive about a separate future beta database.

After CI-gated sync, operator can run:

```bash
sudo systemctl start crc-sync-private-backend.service
bash /opt/clash-royale-companion/backend-github/deploy/aws/inspect-private-beta-postgres.sh
```

Do not paste Docker environment variables, database passwords, connection strings or certificate private keys into chat. If server SSL is off, **do not weaken `sslmode=verify-full`**: establish a reviewed certificate/CA and DNS strategy for any TCP beta connection, or redesign the DB connection boundary with equivalent reviewed authentication and transport protections. Nothing in this step changes the running PostgreSQL container.

## Update — 23 November 2026: PostgreSQL is healthy but metadata login is not

Operator read-only run returned `crc-postgres` with image `postgres:17`, status `running`, health `healthy` and isolated Docker network `crc-private`. Neither a published 5432 port nor a host TCP listener was found. The SQL catalog probe returned `Metadata SQL: unavailable (auth/socket/permissions)`, which does not establish whether the `postgres` database role, the `postgres` maintenance DB or TLS certificate configuration exists. Do not recreate the DB or change authentication to bypass this diagnostic.

A separate redacted follow-up script `deploy/aws/diagnose-private-beta-postgres.sh` detects Unix socket presence, passwordless `pg_isready` responsiveness, effective server `ssl` config (via `postgres -D ... -C ssl`), and the *category* of a failed, non-interactive `psql -w -c 'SELECT 1'` probe. Raw PostgreSQL error text, credentials, Docker environment/config, PGDATA files, DB rows and secrets are **not printed**. The script makes no writes and its mock tests exercise redaction.

After the GitHub CI-gated sync has taken the newly tested head, the operator may run:

```bash
sudo systemctl start crc-sync-private-backend.service
bash /opt/clash-royale-companion/backend-github/deploy/aws/diagnose-private-beta-postgres.sh
```

If `SERVER_SSL_CONFIG=off`, keep the `verify-full` requirement intact; a reviewed private DNS/CA/server-certificate design and isolated application role must be prepared before enabling the beta API. A successful Unix socket or `pg_isready` does **not** prove authenticated TCP+TLS service readiness, and no service should be started until this is resolved.

## Update — 23 November 2026: custom PostgreSQL bootstrap role confirmed

Read-only operator output: `CONTAINER=postgres17_running_healthy`, `UNIX_SOCKET=present`, `POSTGRES_ACCEPTING_CONNECTIONS=yes`, `SERVER_SSL_CONFIG=on`, and `LOCAL_POSTGRES_ROLE_LOGIN=postgres_db_role_missing`. The PostgreSQL *database role* `postgres` is absent; this is consistent with a custom `POSTGRES_USER` bootstrap role and is **not evidence that PostgreSQL is broken**. Server SSL set to `on` does NOT prove host-to-DB certificate chain/hostname verification.

Do **not** recreate the database, create a `postgres` superuser, reset its password, expose port 5432, or loosen authentication. New GitHub-only inspection script `deploy/aws/inspect-private-beta-catalog.sh` reads the existing container's configured bootstrap role and DB **inside** the container, without printing either name or secrets, then runs only fixed SQL `SELECT` catalog checks over the Unix socket. It reports boolean role existence/login/superuser flags for `crc_app` and whether quota tables are visible in that **configured** database, not necessarily in the eventual beta DB. The result is filtered against a strict allowlist; SQL/database errors are suppressed and reduced to safe categories.

After the current GitHub backend CI succeeds and code sync finishes, operator can run (without providing any credentials):

```bash
sudo systemctl start crc-sync-private-backend.service
bash /opt/clash-royale-companion/backend-github/deploy/aws/inspect-private-beta-catalog.sh
```

This does not configure TLS, validate `verify-full`, create users or tables, run migrations, start the beta service, or activate the Worker. Any failed inspection is a reason to review auth and network paths before deployment, **not** a reason to weaken them.

## Update — 23 November 2026: existing quota role/table and next TLS/network decision

Operator's configured-database catalog probe succeeded: `DB_ACCESSIBLE=yes`, `SERVER_SSL=on`, `CRC_APP_ROLE_PRESENT=true`, `CRC_APP_ROLE_LOGIN=true`, `CRC_APP_ROLE_SUPERUSER=false`, `GATEWAY_QUOTA_TABLE_PRESENT=true`, `AI_QUOTA_TABLE_PRESENT=false`. The last is expected while AI remains disabled. **Do not apply migrations or recreate the existing role/table.** Existence does not by itself confirm `crc_app` can reserve quota; actual table privileges still need verification.

The database currently runs in a healthy `postgres:17` container on Docker network `crc-private`, without a host-published PostgreSQL port. There is a separate localhost API on port 8000 and the disabled Cloudflare VPC Service targets localhost port 8001. The review-only host systemd beta template does not itself provide stable Docker DNS for `crc-postgres`; before activating the backend, review whether to place the beta API inside the same private Docker network with a host-loopback-only bind for 8001, or another explicit private route. Never publish DB port 5432 or route the beta API through port 8000.

New redacted, read-only preflight `deploy/aws/check-private-beta-db-path.sh` verifies Docker network type/internal flag, checks the current DB's `crc_app` schema USAGE and quota SELECT/INSERT/UPDATE grants via a fixed SQL query, and inspects the existing server certificate's hostname match against the proposed Docker DNS `crc-postgres` and seven-day validity using OpenSSL. It does not print role/database names, credentials, certificate content or file paths, and prints only fixed allowed results. A matching certificate is **not** proof of trusted CA or of successful libpq `sslmode=verify-full` over TCP. A separate real TLS handshake and strict CA validation are still required before service activation.

Once this exact commit's backend CI passes and the EC2 source-sync timer updates:

```bash
sudo systemctl start crc-sync-private-backend.service
bash /opt/clash-royale-companion/backend-github/deploy/aws/check-private-beta-db-path.sh
```

Keep `BETA_ENABLED=false`, the backend gate unset, live lookup and online AI off. This command only checks the existing DB; it does not install/run services or apply migrations.

## Update — 23 November 2026: DB grants and TLS certificate name look good; actual TLS handshake next

Operator report: `DB_CONTAINER=healthy_on_crc-private`, `DOCKER_NETWORK=internal_bridge`, `SCHEMA_USAGE=true`, `QUOTA_SELECT=true`, `QUOTA_INSERT=true`, `QUOTA_UPDATE=true`, `CERT_FILE=readable`, `CERT_HOSTNAME_MATCH=yes`, `CERT_VALID_7_DAYS=yes`. The `crc_app` role can perform the required quota-table operations in the configured database, without making changes. Certificate metadata matches the candidate DNS name `crc-postgres`, but it has **not** yet been validated against an independent client CA, and the certificate metadata probe did not make a network TLS connection.

A new code-only script `deploy/aws/probe-private-beta-tls.sh` uses `openssl s_client -starttls postgres -connect 127.0.0.1:5432 -servername crc-postgres -verify_hostname crc-postgres -verify_return_error -brief` within the **existing** PostgreSQL container, with its system default trust roots. It will report success only if the OpenSSL process succeeds and explicitly reports a TLS 1.2/1.3 connection and `Verification: OK`. Untrusted/self-signed certificates that are not in the client trust store are treated as **not verified**; the script never suppresses CA validation or copies a server leaf certificate into trust automatically. All raw TLS output (which may include private subjects/paths) is discarded.

This is a **real TLS-layer handshake test** but it is deliberately *not* the finished beta-to-DB verification: it does not connect from a separate beta container, validate Docker DNS from another namespace, authenticate as `crc_app`, or establish `libpq sslmode=verify-full` with a trusted client CA and credentials. The dedicated beta image/entrypoint and private Docker network architecture remain unactivated.

After green GitHub CI and the guarded source sync, inspect without secrets or DB changes:

```bash
sudo systemctl start crc-sync-private-backend.service
bash /opt/clash-royale-companion/backend-github/deploy/aws/probe-private-beta-tls.sh
```

If the default system roots do not trust the existing certificate, investigate the existing CA chain and a securely distributed client trust root; **do not use `sslmode=require`, `verify-ca` as a replacement for `verify-full`, an unreviewed `sslrootcert` copied from the peer, or disabling hostname verification**.

Keep the Worker beta and AI flags false, Tunnel stopped, API port 8001 unused, and local API on port 8000 untouched.


## Update — 23 November 2026: owner-verified private CA and review-only beta Docker client

The EC2 operator identified the existing **public** PostgreSQL CA at `/var/lib/docker/volumes/crc-postgres-data/_data/ca.crt` (not the server private key). The SHA-256 fingerprint, independently recorded in the project conversation, is `A2:74:75:9C:3A:0E:05:26:26:25:F9:5A:F3:51:65:AA:66:28:FD:F4:59:F1:49:58:AE:FA:13:F6:8B:E6:0A:56`. On EC2, operator-side OpenSSL verified `CA:TRUE`, server certificate issuer matching that CA, and `SERVER_CERT_VERIFY=OK` for `crc-postgres`. This established the server certificate chain and hostname **against the designated local CA**. Earlier default-system-root checks failed because that private CA was not trusted by the general-purpose image; that was not a PostgreSQL health problem.

**Code-only changes, not activated:**

1. `api/src/crc_api/beta_db_tls.py` now pins the reviewed public CA fingerprint, checks `CA:TRUE`, insists on DSN host `crc-postgres`, role `crc_app`, TCP 5432, `sslmode=verify-full` and `sslrootcert=/run/crc-beta/db-ca/ca.crt`, and constructs an explicit Python SSLContext with `CERT_REQUIRED` and `check_hostname=True`. The actual production beta ASGI factory rejects missing/unreviewed CA files **before** starting; its asyncpg pool uses this strict SSLContext explicitly. There is no fallback to plaintext/weak SSL.
2. `deploy/docker/Dockerfile.beta` is a dedicated nonroot image distinct from the running `crc_api.main`. Review-only `deploy/docker/compose.private-beta.review.yml` is **profile-gated** and specifies `crc-private` as an existing external Docker network, a single read-only public CA file bind, and localhost-only host port mapping `127.0.0.1:8001:8001`; PostgreSQL 5432 is never published. The beta container binds to all addresses **inside its own Docker namespace**, not to the EC2 public interface.
3. `deploy/aws/stage-public-beta-ca.sh` copies just the reviewed **public CA certificate** from the pre-existing Docker volume into `/etc/crc-beta/trust/db-ca.crt`, checks the pinned fingerprint, CA constraints and validity, and refuses conflicting CA destinations. It does **not** read/mount the database private key, rotate certificates or alter PostgreSQL.
4. `deploy/aws/probe-beta-client-tls.sh` launches a **temporary**, nonroot PostgreSQL-image TLS client on the same isolated `crc-private` network, with **only** the copied public CA mounted read-only; checks Docker DNS, real PostgreSQL SSLRequest/TLS, CA trust and hostname verification, and tests a wrong hostname must fail. This test does not log in to the DB or read/write any SQL records; no credentials are passed.
5. GitHub CI job `private-beta-tls` uses a completely **disposable** PostgreSQL 17, generated test CA/server certificate and isolated Docker network. It tests libpq `verify-full` success, refusal of wrong host/unrelated CA, and the actual beta `asyncpg` SSLContext path. It cannot use or modify AWS production data or certificates.

**Deployment remains OFF:** nothing from the new Docker compose is installed or running on EC2. Worker `BETA_ENABLED=false`, `BETA_AI_CHAT_ENABLED=false`, Tunnel disconnected, and backend approval marker unset. The old host-only systemd review template is **not** sufficient to reach `crc-postgres` Docker DNS and is superseded for the isolated-network design; do not install it for this flow.

**Next operator actions, only after this exact GitHub commit passes all CI checks and EC2 sync completes:**

```bash
sudo systemctl start crc-sync-private-backend.service
sudo bash /opt/clash-royale-companion/backend-github/deploy/aws/stage-public-beta-ca.sh
bash /opt/clash-royale-companion/backend-github/deploy/aws/probe-beta-client-tls.sh
```

The second command creates only `/etc/crc-beta/trust/db-ca.crt` and its parent trust directory with root ownership; it does not change a service, port or DB. The third command briefly creates an independent disposable Docker **client**, not a beta API service. A real `crc_app` authenticated TCP connection from the eventual beta runtime, protected env/secrets and session/invite authentication still require final deployment testing and explicit owner approval. The `crc-private` internal network deliberately has no general internet egress, so online Supercell/AI networking would need a separate reviewed egress design and remains disabled.
