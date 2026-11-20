# SP-DEPLOY-01 — Deployment readiness, not a production launch

**Status: implementation in progress.** GitHub branch \`feat/backend-bootstrap\` remains a Draft PR; no merge, no provisioned server, no public backend or new billing.

## What we know

1. The site frontend is currently hosted on Cloudflare Workers Free in **sample-only staging mode**. The live Supercell lookup is deliberately disabled.
2. The Python FastAPI backend requires an official Supercell API key stored server-side, not in the frontend. Its outbound connection must originate from the IPv4 address authorized for the key.
3. Ordinary Workers Free does not offer a guaranteed, dedicated, fixed outbound IPv4 suitable for this requirement. Cloudflare offers other network/egress products, which are **not assumed to be free or enabled**.
4. A Docker port published without an explicit host address can listen on every interface; Docker documents explicit \`127.0.0.1\` host binding for localhost-only publication. However, Docker bridge NAT changes the peer address seen in a container. The current FastAPI **immediate-peer loopback check** intentionally rejects those bridge peers.
5. We therefore **do not** publish this API through Docker or a tunnel in the current milestone. The Dockerfile is useful for CI packaging and isolated health checks; it binds inside its own network namespace and has no exposed port.

Sources:
- Docker: https://docs.docker.com/engine/network/port-publishing/
- Cloudflare Workers/VPC: https://developers.cloudflare.com/workers-vpc/configuration/vpc-networks/
- Supercell Developer API: https://developer.clashroyale.com/

## Current protections (local-only)

- \`CRC_RUNTIME_MODE=local\` is the **only** accepted runtime. Any remote/staging/production mode fails before application startup.
- CORS settings must refer to exact localhost/loopback HTTP(S) origins; arbitrary external and wildcard origins cause startup failure. CORS is never authorization.
- Untrusted Host headers are blocked. Socket-peer admission rejects non-loopback addresses and does not trust \`X-Forwarded-For\`.
- Optional internal token and bounded in-process request limiter.
- Bounded upstream Supercell request budget and RAM-only validated-response cache.
- API key stays on backend, never in browser JavaScript, GitHub, or Cloudflare Worker source.
- Container test image runs as non-root, with loopback-only listener. CI launches the image with \`--network none --read-only --cap-drop ALL\` and validates health from within the container.

## What must be delivered before ANY public player lookup

| Gate | Acceptance criteria | Current status |
|---|---|---|
| Official API access | Server egress IPv4 registered to legitimate API key; real live smoke with secret not logged | Blocked: no approved host |
| Public API authentication | Real session or abuse-resistant identity, no shared secret in browser, authorization checks | Not implemented |
| Gateway isolation | Private backend ingress, pinned origin, TLS, no arbitrary proxy targets, verified trusted proxy boundary | Not implemented |
| Distributed quotas | Per-client and global upstream rate budgets enforced consistently across processes | Not implemented |
| Durable state | Reviewed minimal PostgreSQL schema + migrations, privacy/retention rules before collecting user data | Not implemented |
| Operational controls | Structured safe logs, Sentry and alert thresholds, restart/backup guidance | Not implemented |
| API contract | Versioned OpenAPI and contract tests for real DTOs including nullable fields | Partially documented |
| Legal review | Official Supercell Fan Content / API conditions evaluated for branding, ads, monetization | Outstanding |
| End-user acceptance | Automated tests first; manual mobile testing only after feature-complete MVP | Deferred by owner |

## Deployment options (no invented cost estimates)

**Option A — personal Windows PC, private proof of concept.** Use local Python FastAPI on \`127.0.0.1\` and official API key allowlisting its current public IPv4. No public service. Useful for one-owner debugging; not a reliable consumer website or always-on connection.

**Option B — fixed-egress IPv4 host (preferred public-MVP candidate).** Evaluate low-cost VM/container host with guaranteed stable outbound IPv4, owner-approved recurring spend and uptime. Add a protected origin gateway and shared request-budget controls before any public exposure. Keep frontend hosting on Cloudflare Free where feasible.

**Option C — Workers Free only.** Continue serving static UI/sample analysis. Do not claim it can safely provide Supercell account lookup from a fixed, dedicated outbound IPv4.

## Current local Docker artifact

Use \`deploy/docker/Dockerfile.local\` with the repo root as build context:
\`\`\`sh
docker build -f deploy/docker/Dockerfile.local -t crc-local-ci .
docker run --rm --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges crc-local-ci
\`\`\`
The container intentionally cannot make live Supercell requests or accept external connections. CI uses \`docker exec\` to verify local health from **inside** the container. Do not publish or forward port 8000; the local peer gate is not yet designed for Docker ingress, Cloudflare Tunnel, or reverse proxies.

### Status and next engineering milestone

After the Docker smoke test and security suite pass, the next substantial blocker is designing a **separate, explicit remote admission mode** (with authenticated proxy boundaries, distributed quotas and fixed egress), rather than weakening local loopback checks. We will evaluate hosting and costs before enabling it. Continue to keep main untouched pending owner approval.
