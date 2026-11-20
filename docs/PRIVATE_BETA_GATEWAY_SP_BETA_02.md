# SP-BETA-02 — Protected FastAPI beta entrypoint (integration candidate)

**Status:** implemented as a *separate* FastAPI application in \`api/src/crc_api/beta_gateway.py\`, with mocked and ephemeral-PostgreSQL integration tests. **Not deployed. No change to the existing Cloudflare staging site.** Do not merge or provision paid infrastructure without owner approval.

## Two completely separate modes

- \`crc_api.main:app\` is the existing local development application. It still refuses remote/production runtime modes, remote socket peers and nonlocal CORS. Do not weaken it.
- \`crc_api.beta_gateway:create_beta_app\` is a separate app factory. It is never imported/mounted by the local app. It has no default app instance. It fails on missing configuration, missing provider secret, unavailable database pool and invalid Access policy.

The private beta app exposes only:
- \`GET /api/v1/capabilities\`: authenticated, non-secret state, still advertises \`safe_public_exposure:false\`.
- \`GET /api/v1/catalog/cards\`: authenticated, read-only, official catalog via server-side key.
- \`GET /api/v1/players/{tag}/snapshot?limit=25\`: authenticated, fixed snapshot DTO, at most one profile and one Battle Log upstream lookup. Battle Log failures produce a truthful partial result. A Player Tag is not ownership verification.

**No public health endpoint**, no CORS middleware, no authentication bypass for unknown paths and no supercell key or JWT in response bodies. The app requires an exact configured hostname.

## Request sequence, as implemented

1. Check exact protected Host and any Origin (must match \`https://<protected-host>\`). This is only a browser defense-in-depth check, never authentication.
2. Require \`Cf-Access-Jwt-Assertion\` header. Reject missing JWT with HTTP 401.
3. Verify **RS256 signature and \`iss/aud/sub/iat/exp\`**, using pinned Cloudflare Access team JWKS, and check an explicit approved subject allowlist. Reject invalid JWT with 403, unreachable JWKS with 503.
4. Obtain an asyncpg connection. Reserve shared per-member/global counters **in a single transaction**. Refuse exceeded quotas with 429 and \`Retry-After\`; database outage fails closed with 503.
5. Only then dispatch to the read-only Supercell endpoints.
6. Return \`Cache-Control: no-store\`, \`X-Request-ID\`, security headers and sanitized errors. No auth or provider secrets logged or echoed.

The quota design has a fixed 60-second UTC window; it is not a sliding window or the official Supercell quota. Application access and database network policies must also prevent direct unauthorized requests.

## Environment checklist (examples ONLY; do NOT commit real values)

- \`CRC_BETA_RUNTIME_GATE\`: exact explicit beta enable flag. It is **not a secret** and not a substitute for owner approval. Keep unset until approved.
- \`CRC_BETA_HOST\`: exact protected hostname, e.g. \`beta.example.com\`. Must match incoming Host.
- \`CRC_BETA_TEAM_DOMAIN\`: your actual \`team.cloudflareaccess.com\` tenant hostname, never an arbitrary JWKS URL.
- \`CRC_BETA_AUDIENCE\`: Cloudflare Access application's Audience (AUD) tag.
- \`CRC_BETA_ALLOWED_SUBJECTS\`: comma-separated stable Access subject IDs for the approved testers, not Player Tags or email claims.
- \`CRC_BETA_QUOTA_HMAC_HEX\`: securely generated 32-byte-or-longer hex secret; separate from Access JWT and Supercell secrets.
- \`CRC_BETA_POSTGRES_DSN\`: private PostgreSQL connection string. Must be protected by your secrets manager and private network. Production DB TLS requirements are **not enforced in this prototype**, so do not deploy without review.
- \`SUPERCELL_API_KEY\`: official server-only key registered to the host's fixed outbound IPv4.

Example package install for isolated verification: \`python -m pip install -e '.[security,test]'\`. There is deliberately **no publicly runnable production command in this document**, because the private-origin isolation, lifecycle and host networking have not been provisioned or reviewed.

## GitHub Actions / tests

- \`api/tests/test_beta_gateway.py\`: signed Access JWTs with mocked JWKS, forged headers and wrong Origin/Host, missing token, resource access, quota denial, DB failure, snapshot DTO and no unverified upstream calls.
- Disposable PostgreSQL 17 test uses real asyncpg connections and transactional quotas. No user accounts, player data or real provider credentials.
- The existing \`api/tests/test_cloudflare_access.py\` and \`test_shared_quota.py\` cover claims, key rotation, rollback and concurrent quota behavior.
- Existing local Docker build smoke remains independent and network-isolated.

## Unfinished before beta activation

1. Obtain the owner's **explicit** approval for paid fixed-IPv4 hosting and any billing.
2. Provision **private-origin isolation** (e.g. reviewed Cloudflare Tunnel/private network or mTLS) and stable outbound IPv4. Don't expose a beta backend socket directly to the Internet.
3. Create real Cloudflare Access application and test invitations, expiry/revocation, header propagation, trusted host and TLS, and secret handling. No Access app has yet been created.
4. Add PostgreSQL role/permissions, pool TLS and retention policy, automated bucket cleanup, backup/restore and monitoring. Current quota table migration is still draft and has never been applied to production.
5. Verify browser session integration. Current public staging JavaScript uses \`credentials:'omit'\`, and must be separately adapted for a same-origin Access-protected beta with a CSRF-reviewed design. Do not put Access tokens or internal keys into browser JavaScript.
6. Deploy and complete real network, unauthorized-origin, authentication and Supercell allowlisted-IP smoke tests before enabling live lookup.
7. Review Supercell Fan Content and API terms, expert coaching rules and mobile acceptance after MVP feature completion.

## Owner workflow and invariants

No deployment or cost incurred. No Supercell secret or real tester identity committed. Cloudflare existing site stays sample-only. Draft PR #2 is not merged to main. This milestone validates the application security flow **in isolated automated tests**, not actual Cloudflare Access app or real fixed-IP connectivity.
