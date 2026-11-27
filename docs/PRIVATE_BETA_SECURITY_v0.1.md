# SP-BETA-01 — Private beta security foundation (superseded Access design)

This document's original Cloudflare Access/JWKS design is superseded. Cloudflare Zero Trust onboarding requested payment details, so the project moved to a no-card invite-code session design. Do not implement the old Access-specific instructions.

The current authoritative design and state are documented in SP-BETA-02, SP-BETA-04 and SP-BETA-05.

## Current no-card trust path

Browser
→ separate private Cloudflare Worker with invite-code login
→ Secure, HttpOnly, SameSite=Strict session cookie
→ short-lived HMAC-signed Worker assertion
→ Cloudflare Workers VPC Service through an outbound-only Tunnel
→ dedicated FastAPI beta gateway
→ independent backend assertion verification
→ PostgreSQL transactional member and global quota reservation
→ optional Supercell API, only after a separate live-lookup approval

The Worker stores only SHA-256 invite-code hashes mapped to opaque subject IDs. The browser never sees either HMAC key or the backend assertion. The backend validates the exact HTTPS issuer, audience, expiry, subject allowlist and jti format before quota reservation. The Supercell key and PostgreSQL DSN remain server-side.

## Current inactive state

- Private Worker crc-private-beta-gateway.alirezaanari117.workers.dev is deployed with 14 assets and BETA_ENABLED=false.
- The Worker has a PRIVATE_API VPC binding to crc-private-beta-api, but the Cloudflare Tunnel is down.
- The dedicated backend beta service is not installed; the local-only API remains separate.
- Invite-code, session HMAC and assertion HMAC secrets are not configured.
- Supercell live lookup and online AI remain disabled.
- The public sample Worker is independent and unchanged.

The old Cloudflare Access verifier and Access-specific browser flow are not part of the current no-card request path. Keep the old source only for historical review until backend cleanup is approved; do not mount or call it from the beta gateway.

## Security invariants

- No public backend socket or direct PostgreSQL port.
- No Cloudflare Access checkout, payment card, paid Zero Trust plan or permanent AWS key is required for the current architecture.
- Worker off-switch, backend runtime gate, live lookup switch and online AI switch remain independent.
- Player Tag is not ownership verification.
- No live upstream call until private origin, identity, quota, privacy and rollback tests pass.
