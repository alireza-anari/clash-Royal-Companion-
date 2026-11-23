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
