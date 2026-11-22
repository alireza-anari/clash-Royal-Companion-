# SP-BETA-05 — Private beta deployment, health, and emergency rollback

**Status: source and offline automation only. As of 2026-11-21, nothing in this document has been deployed.** The existing public Cloudflare staging site stays sample-only. PR #2 (backend) and PR #4 (frontend/edge) remain separate drafts; `main` is untouched.

## Deliverables

- `api/src/crc_api/release_preflight.py`: offline, read-only release assessor and printable rollback plan. It cannot connect to Cloudflare, turn on Supercell, deploy a Worker, or buy a server.
- `deploy/release/beta-manifest.example.json`: example with **both switches OFF**, no credentials, blank immutable commit IDs, and all evidence fields false.
- `deploy/release/beta-deployment.blueprint.json`: non-deployable binding and environment contract for distinct beta Worker, private VPC Service and Backend. Deliberately has no domain, service ID, keys or approval.
- `GET /api/v1/health/ready` in the separate `crc_api.beta_gateway` app: an **authenticated** diagnostic. It verifies a short-lived Worker HMAC assertion and reserves shared PostgreSQL quota. A successful response confirms those components succeeded for this request. It **does not** contact Supercell or prove the network/VM is production-ready.
- Frontend PR #4 allows **only** this additional protected health path through the private VPC Service Worker and same-origin invite session. The public sample Worker is unchanged.
- GitHub Actions checks that the committed release template is disabled and runs the new tests. No workflow has permissions or credentials to deploy a beta environment.

## 1. Before authorizing any real infrastructure

Record real backend and frontend **40-character commit SHAs** in a separate operator-owned manifest, not the committed example. Confirm the following independently. Each boolean in the template is an **operator attestation**, not evidence independently verified by the script:

1. Product owner has reviewed the monthly bill, chosen a fixed-egress host, and approved recurring charges.
2. Real outbound IPv4 is guaranteed and correctly allowlisted in the private Supercell developer API key.
3. The private Worker validates invite codes, serves only an HttpOnly session cookie, and signs short-lived backend assertions. Every asset and API route is session-gated; alternate/preview routes are disabled or equally protected.
4. Cloudflare VPC Service is pinned to **one** private origin behind a reviewed Tunnel, not a general public proxy; backend has no open public ingress.
5. The beta backend independently validates the Worker HMAC assertion, exact issuer, audience, expiry, jti and invite-subject allowlist.
6. PostgreSQL has least-privilege credentials, `sslmode=verify-full` with working CA/hostname verification, migration review, enforced quota, and a **running** retention cleanup job.
7. Invite-code browser session, cookie flags, expiry, logout and re-login have been checked against the real beta hostname without exposing tokens in JavaScript.
8. Monitoring, alerting, emergency stop and disaster recovery have been reviewed. Test failures in PostgreSQL, HMAC verification and private VPC with no Supercell calls.
9. Privacy and Supercell Fan Content/API terms review is complete. Final manual mobile acceptance happens only after MVP feature completion, per owner preference.

No proof above has been marked complete in the committed manifest.

## 2. Offline preflight commands (no paid services, no network)

From repository root with Python backend installed:

```sh
python -m crc_api.release_preflight deploy/release/beta-manifest.example.json --mode lint
python -m crc_api.release_preflight deploy/release/beta-manifest.example.json --mode require-disabled
python -m crc_api.release_preflight deploy/release/beta-manifest.example.json --mode preflight
python -m crc_api.release_preflight deploy/release/beta-manifest.example.json --mode rollback
```

If the package is not installed, from `api/` run `python -m pip install -e '.[test]'` and reference `../deploy/release/beta-manifest.example.json` instead.

- `lint` validates the exact JSON schema, no unknown fields, and boolean flags.
- `require-disabled` exits nonzero whenever `edge_enabled` **or** `backend_live_lookup_enabled` is true. This runs in CI.
- `preflight` lists unconfirmed checklist items and commit IDs; it exits nonzero while they remain incomplete. A green offline report still does **not** authorize a live deployment.
- `rollback` **prints** a runbook; it never executes commands, touches resources, reads secrets or changes the manifest.

The committed example must remain all-disabled forever. Store any actual operator attestation outside the repository and never include API tokens, JWTs, PostgreSQL passwords or private profile JSON in it.

## 3. Proposed deployment order — NOT EXECUTED

1. Obtain owner approval for hosting and spend. Provision the fixed-egress VM, private PostgreSQL and Worker invite authentication + VPC Service. Review the current Cloudflare support/plan availability before any purchases.
2. Bind the separate private beta Worker source `deploy/cloudflare/beta-edge-worker.mjs` to **ASSETS** and **PRIVATE_API** only after the invite-code session gate guards the entire beta domain. Keep its `BETA_ENABLED=false`.
3. Prepare `crc_api.beta_gateway:create_beta_app` with secrets injected only through approved private secret infrastructure. Keep `CRC_BETA_LIVE_LOOKUP_ENABLED=false`. Build from pinned commits; avoid using mutable `latest` images.
4. Apply reviewed PostgreSQL migration, schema permissions, TLS and a monitored quota-cleanup schedule. Keep origin inaccessible from the Internet. Complete private-origin and HMAC assertion-chain tests.
5. Validate the protected `GET /api/v1/health/ready`: expect `status=ready_for_authenticated_requests`, `checks.worker_assertion=verified`, `checks.shared_quota=reserved`, `supercell_connectivity_checked=false`, and `live_lookup_enabled=false`. Unauthorized clients must fail. Its 200 status is not an independent container health or upstream probe.
6. Confirm the real egress IPv4 with the official key's IP allowance, budget, rate limits, alerting, and off-switch drills. Real credential smoke tests must happen only on the authorized VM and must never log the key.
7. With a reviewed rollout and owner approval, flip the **backend** live switch and restart/redeploy the private process; verify it is still private. Then flip the **beta Worker** switch and publish **only the distinct beta domain**. Check that public sample stage remains independent and unchanged.
8. Release gradually to invited testers, observe quota errors and provider health, and maintain a rollback decision window. Do not claim the user-facing MVP has completed acceptance testing.

The current local Dockerfile is intentionally not a public beta container; do not publish its port or disable its loopback gate as a workaround.

## 4. Emergency stop / rollback order — OPERATOR ACTION REQUIRED

**Primary fast stop:** set the separate beta Worker's `BETA_ENABLED=false` and deploy the off-version, or immediately disable its protected route in the control plane as appropriate. This blocks **all beta requests**; it must not modify the public sample Worker. Cloudflare configuration changes and deployments take effect after control-plane propagation—do not promise zero delay.

**Secondary stop:** set `CRC_BETA_LIVE_LOOKUP_ENABLED=false` on the backend and **restart/redeploy** that process. This independently prevents new official Player Snapshot/card requests even if a beta Worker route were still present. Confirm `/api/v1/capabilities` reports disabled under a signed Worker assertion.

**Identity incident:** suspend invites or the beta invite-code session gate and revoke compromised invite codes and rotate the Worker session/assertion keys. Do not expose the backend to permit access during troubleshooting.

**Verify containment:** unauthorized and authenticated beta requests cannot reach Supercell; the Worker returns a disabled response; confirm telemetry shows no new outbound requests; the sample-only Stage still works. Record incident time, active commit/version IDs and non-sensitive logs.

**Reverting code:** Cloudflare's documented Workers rollback creates a **new deployment** assigning the selected prior version 100% traffic. That does not revert PostgreSQL state, external keys, invite membership, VPC configuration, or a Supercell IP allowlist. Never assume rollback to an older Worker automatically re-establishes security or revokes invite sessions. Prefer the off-switches first, then a reviewed pinned previous version if needed.

**Data rollback:** do not auto-revert quota database migrations. Review PostgreSQL schema and retention separately; counters may be needed for security auditing and provider protection. Maintain separate backup/restore and migration-forward procedures.

**Recovery:** reactivation requires explicit owner sign-off, new preflight, verification of invite authentication and private origin, full automated tests and real protected smoke. Re-enable the backend and Worker in that order only after review.

## 5. Monitoring probes (planned, not installed)

- Authenticated `GET /api/v1/health/ready` is useful for an operator's private readiness diagnostic, but it consumes a **member and global quota unit** and must not run at high frequency.
- Separate internal container liveness may later be provided over a **non-public localhost/Unix socket**; this is **not** implemented. Do not add a public unauthenticated health bypass merely to make a load balancer green.
- Observe successful invite/session decisions, 401/403/429/503 rates, PostgreSQL reservation latency, zero unexpected Supercell calls in off state, and cache freshness. Never log JWT, API keys, personal player JSON, or quota HMAC secrets.
- A protected health response does not prove Supercell availability; a live provider probe is a distinct, explicitly authorized, budgeted operation.

## 6. Current blockers

No approved fixed-egress VM, real private origin, production invite/session secrets, private beta Worker deployment, persistent PostgreSQL, TLS CA trust setup, provider key, configured cleanup scheduler or real beta browser session exists yet. Cross-branch end-to-end integration is still required. **CI success alone is not authorization to deploy.**

## References

- Cloudflare Workers rollback: https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/
- Cloudflare VPC Service bindings: https://developers.cloudflare.com/workers-vpc/configuration/vpc-services/
- Cloudflare Workers VPC is available on Workers Free during open beta: https://developers.cloudflare.com/workers-vpc/platform/pricing/


## No-card authentication replacement (source only)

Cloudflare Zero Trust Free onboarding may request payment details even though the plan itself is $0; this project does not need that checkout. The MVP no-card path therefore uses an invite-code session at the edge instead of Access:

- Store only SHA-256 invite-code hashes mapped to opaque subject IDs in a Worker Secret; never commit invite codes.
- On successful login, set a Secure, HttpOnly, SameSite=Strict, host-only cookie. JavaScript never reads the cookie or any signing key.
- The Worker validates the cookie on every beta asset/API request and signs a 60-second HS256 assertion for the backend.
- The backend verifies the signature, exact HTTPS issuer, audience, expiry, jti and per-user allowlist before PostgreSQL quota reservation or any upstream request.
- Keep separate random HMAC keys for browser sessions and Worker-to-backend assertions. The latter is mirrored from Cloudflare Worker Secrets to AWS SSM; it is never stored in GitHub.
- Workers VPC/Tunnel remains the private network path. It is independent of Cloudflare Access and is available during its open beta on Workers Free.

This is a small private-beta admission mechanism, not a replacement for a full consumer identity system. Invite rotation/revocation and session expiry remain required operational controls.


## No-card beta configuration contract

The private Worker is intended for the dedicated hostname `crc-private-beta-gateway.alirezaanari117.workers.dev`; it is not the public sample Worker. Set the exact `BETA_HOSTNAME` and `BETA_AUTH_ISSUER=https://<that-hostname>`. Keep preview URLs disabled and set `BETA_ALLOW_WORKERS_DEV=true` only for this dedicated Worker.

Worker variables/secrets:

- `BETA_ENABLED=false` until the backend and VPC path pass the release gate.
- `BETA_AUTH_AUDIENCE=crc-private-beta-api`.
- Secret `BETA_INVITE_CODES_JSON`: JSON object mapping SHA-256 hex digests of invite codes to opaque subject IDs (for example `tester_001`). Do not store raw codes here or in GitHub.
- Secret `BETA_SESSION_HMAC_HEX`: a random 32-byte key used only to sign HttpOnly browser sessions.
- Secret `BETA_ASSERTION_HMAC_HEX`: a different random 32-byte key used only to sign Worker-to-backend assertions.

Backend private environment:

- `CRC_BETA_HOST`, `CRC_BETA_AUTH_ISSUER`, `CRC_BETA_AUTH_AUDIENCE`, and `CRC_BETA_ALLOWED_SUBJECTS` must match the Worker host, audience, and opaque subject IDs.
- `CRC_BETA_WORKER_ASSERTION_HMAC_HEX` must equal the Worker assertion key and must be injected into the backend process from a protected secret store (AWS SSM Parameter Store is the planned source). The SSM-to-process injection is still a deployment task; never store it in GitHub or the repository.
- `CRC_BETA_QUOTA_HMAC_HEX` is also a backend secret and must be injected from the same protected secret store.
- Keep `CRC_BETA_LIVE_LOOKUP_ENABLED=false` until the Supercell egress IP, provider key, quota, database, and privacy checks are complete.

Generate invite codes and HMAC keys locally with a cryptographically secure random generator; never paste raw codes or keys into this chat. Invite codes remain valid until removed from the Worker secret. Existing sessions last at most eight hours; rotating the session HMAC key invalidates all active sessions. This is a limited private-beta gate, not consumer-grade account recovery or email verification.
