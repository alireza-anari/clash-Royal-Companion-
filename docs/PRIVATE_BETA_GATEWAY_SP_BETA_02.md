# SP-BETA-02 — no-card invite-only private beta gateway

**Status (22 November 2026): the separate Cloudflare edge Worker and its 14 static assets are deployed, but the Worker is deliberately disabled. The backend beta service, tunnel connection, invite secrets and HMAC key injection are not ready. No live Supercell lookup or AI request is enabled.**

Cloudflare Zero Trust / Access is not used in this no-card design. Workers VPC is currently in public beta and is free on Workers plans; no checkout or payment card is required for this path.

## Two separate backend applications

- `crc_api.main:app` is the existing local development application. It remains local-only and is not the private beta API.
- `crc_api.beta_gateway:create_beta_app` is a separate ASGI factory. It fails closed without the explicit runtime gate, exact host, invite-subject allowlist, Worker HMAC assertion key, quota key, verified-TLS PostgreSQL DSN and database availability.

Do not mount the beta app into the local app. Do not enable it until the release gate is complete.

## Request sequence

1. An unauthenticated browser is redirected to `/login`. The login page is served from the Worker static-assets binding.
2. `POST /api/v1/auth/login` accepts only same-origin JSON containing an invite code. The Worker SHA-256 hashes the code and compares it with the hash-to-opaque-subject mapping in `BETA_INVITE_CODES_JSON`. Raw invite codes are never stored in the Worker configuration or repository.
3. Successful login sets a host-only `__Host-crc_beta_session` cookie with `Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`. JavaScript cannot read the cookie or either HMAC key.
4. Every beta asset and API route requires a valid session cookie. API routes are strictly allowlisted. Preview URLs are disabled; the public sample Worker is a different script and hostname.
5. The Worker signs a short-lived HS256 assertion in `X-CRC-Worker-Assertion`, with pinned issuer, audience, opaque subject, issued/expiry timestamps and random `jti`. The assertion expires after at most 60 seconds.
6. The backend independently verifies that signature and exact issuer/audience, checks expiry, `jti` format and the explicit invited-subject allowlist, then reserves per-member and global PostgreSQL quota.
7. Only after successful identity and quota checks may the backend call the official Supercell API. The live-lookup switch remains default-off. The online coach is separately disabled and requires per-message consent.

The Player Tag is not proof of account ownership. No JWT, API key, invite code, database password or HMAC key is returned to the browser or logged.

## Exact edge routes

- `GET /login` and `GET /beta-login.js`: unauthenticated login resources only.
- `POST /api/v1/auth/login`: same-origin invite-code exchange.
- `GET /api/v1/auth/session`: authenticated session status.
- `POST /api/v1/auth/logout`: same-origin cookie expiry.
- `GET /api/v1/health/ready`, `/api/v1/capabilities`, `/api/v1/catalog/cards`, and `/api/v1/players/{tag}/snapshot?limit=1..25`: authenticated allowlisted API.
- `POST /api/v1/coach/chat`: authenticated, separately disabled by default, and requires explicit consent to external inference.
- Unknown paths, other methods, cross-origin requests, redirects, oversized bodies and non-JSON origin responses fail closed.

## Current Cloudflare resources — verified

- Worker script: `crc-private-beta-gateway`.
- Hostname: `crc-private-beta-gateway.alirezaanari117.workers.dev`.
- Preview URLs: disabled.
- Static assets: 14 files attached through the `ASSETS` binding.
- `BETA_ENABLED=false` and `BETA_AI_CHAT_ENABLED=false`.
- The `PRIVATE_API` binding points to VPC Service `crc-private-beta-api`, service ID `01a202d5-1889-72d3-9a12-4a2838612589`.
- The VPC Service targets `127.0.0.1:8001` (updated and verified on 23 November 2026) through Tunnel ID `45520fe5-2670-417e-8f8e-932c60821aa6`.
- The Worker returns HTTP 503 with `BETA_NOT_CONFIGURED` while disabled. This is the expected fail-closed state, not a successful backend health check.

The Cloudflare Tunnel currently has no active connector. The last verified EC2 Docker configuration used the `crc-edge-egress` bridge network; that does not make the host's `127.0.0.1:8001` reachable from inside the container. Before the VPC route can work, the connector must be recreated with host networking (or another explicitly reviewed path that can reach the loopback-only service).

## Current backend and secret blockers

- The separate `crc-private-beta.service` was reported as not installed at the last EC2 readiness check.
- The existing `crc-local-api.service` is a local-only application and is not the beta gateway. On 23 November 2026 the operator reported it active, with a listener observed on port 8000 (process ownership not independently verified). Preserve it; the review-only beta service template now uses `127.0.0.1:8001`, provided that port is verified free. On 23 November 2026 the disabled Cloudflare VPC Service was retargeted to `127.0.0.1:8001` and verified through the Cloudflare API. The Tunnel remains down, Worker access and AI remain disabled, and backend installation and rollback review are still required. Do **not** enable the edge until all release gates pass.
- No Worker invite-code/session/assertion secrets have been configured by the deployment pipeline. Required Worker secrets are `BETA_INVITE_CODES_JSON`, `BETA_SESSION_HMAC_HEX` and `BETA_ASSERTION_HMAC_HEX`.
- The backend needs the matching `CRC_BETA_WORKER_ASSERTION_HMAC_HEX`, separate `CRC_BETA_QUOTA_HMAC_HEX`, `CRC_BETA_ALLOWED_SUBJECTS`, exact issuer/audience/host and verified-TLS PostgreSQL DSN, all injected from protected infrastructure rather than GitHub.
- `CRC_BETA_RUNTIME_GATE` must remain unset until the owner explicitly approves activation.
- `CRC_BETA_LIVE_LOOKUP_ENABLED=false` and `BETA_AI_CHAT_ENABLED=false` remain mandatory until the full release gate passes.
- GitHub AWS OIDC and backend SSM workflows are currently skipped because their required AWS role repository variables are not configured. The EC2 code-pull timer only synchronizes source; it does not install or restart services.

## Required private environment

Worker plain-text variables (not secrets):
- `BETA_ENABLED=false`
- `BETA_HOSTNAME=crc-private-beta-gateway.alirezaanari117.workers.dev`
- `BETA_AUTH_ISSUER=https://crc-private-beta-gateway.alirezaanari117.workers.dev`
- `BETA_AUTH_AUDIENCE=crc-private-beta-api`
- `BETA_ALLOW_WORKERS_DEV=true`
- `BETA_AI_CHAT_ENABLED=false`

Worker Secrets:
- `BETA_INVITE_CODES_JSON`: JSON map from SHA-256 hex invite-code hashes to opaque subject IDs.
- `BETA_SESSION_HMAC_HEX`: random 32-byte key, session signing only.
- `BETA_ASSERTION_HMAC_HEX`: different random 32-byte key, Worker-to-backend assertions only.

Backend private environment:
- `CRC_BETA_RUNTIME_GATE`: exact explicit owner-approval marker; keep unset until release approval.
- `CRC_BETA_HOST`, `CRC_BETA_AUTH_ISSUER`, `CRC_BETA_AUTH_AUDIENCE`, `CRC_BETA_ALLOWED_SUBJECTS`.
- `CRC_BETA_WORKER_ASSERTION_HMAC_HEX`: same bytes as Worker assertion secret, injected from AWS SSM.
- `CRC_BETA_QUOTA_HMAC_HEX`: separate random key, injected from AWS SSM.
- `CRC_BETA_POSTGRES_DSN`: private DSN with `sslmode=verify-full` and the installed CA/hostname.
- `CRC_BETA_LIVE_LOOKUP_ENABLED=false`.
- `CRC_BETA_AI_ENABLED=false` until separately approved; OpenRouter key remains in SSM and is read only when AI is enabled.

Never commit or paste raw invite codes, keys, DSNs, player data or AWS credentials into GitHub or this chat. Rotating the session HMAC key expires existing browser sessions. Removing an invite hash revokes future logins for that code.

## Verification

- Backend CI: 219 tests passed on the latest verified backend test run.
- Frontend/edge CI: 84 tests passed on the latest verified frontend test run.
- Private Worker deploy workflow verifies the distinct script, static assets, fail-closed response and disabled switches. It does not start the AWS backend, reconnect the Tunnel, read SSM secrets or enable live lookup.
- No real invite login, private VPC request, backend HMAC chain, Supercell request or AI request has been performed.

## Security invariants

- Public sample staging remains independent and sample-only.
- No public backend socket or direct PostgreSQL port is exposed.
- No Cloudflare Access checkout, payment card, paid plan or permanent AWS key is required for the current design.
- Worker off-switch and backend live-lookup off-switch remain independent.
- A successful CI run is not authorization to enable the beta.


## Update — 23 November 2026: reviewed CA and independent Docker backend design

The operator identified the existing PostgreSQL private CA and verified the server certificate against it with the exact DNS name `crc-postgres`. The public CA SHA-256 fingerprint pinned for the beta runtime is `A2:74:75:9C:3A:0E:05:26:26:25:F9:5A:F3:51:65:AA:66:28:FD:F4:59:F1:49:58:AE:FA:13:F6:8B:E6:0A:56`. This public fingerprint is not a password; no CA private key or production DSN is stored in Git.

The **new review-only path** is `deploy/docker/compose.private-beta.review.yml` with a non-root beta image on the existing internal Docker network `crc-private`, and a host **loopback-only** map `127.0.0.1:8001:8001`. The compose profile blocks default startup. The backend loads the public root CA from a single file mounted read-only at `/run/crc-beta/db-ca/ca.crt`, pins its fingerprint, requires `sslmode=verify-full`, and uses an explicit hostname-verifying TLS context in `asyncpg`. A guarded operator script `deploy/aws/stage-public-beta-ca.sh` can stage only the public CA for that mount. A disposable client script `deploy/aws/probe-beta-client-tls.sh` performs an independent CA/hostname handshake on Docker's private network (without authenticating to PostgreSQL or creating a permanent service).

Do not use the older host-only systemd service template to access Docker DNS. Do not `docker compose up`, set any activation marker, attach a Tunnel, or enable the Worker until TLS, database authentication, application authorization, invite secrets, quota protection and rollback are verified together. The internal bridge intentionally prevents generic internet egress; live Supercell and online AI remain off and need a separately reviewed outbound routing design.

