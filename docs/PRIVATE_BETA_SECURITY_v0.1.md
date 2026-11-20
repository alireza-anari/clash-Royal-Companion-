# SP-BETA-01 — Private-beta gateway security foundation (draft)

**Status: code + automated tests only, NOT connected to HTTP routes, NOT deployed.** This package is an architecture and code review candidate for a small invite-only beta, not a claim that the website has live Supercell account search.

## Trusted request path (target, not currently operating)

```text
Browser / authenticated beta tester
  -> Cloudflare Access policy on the beta hostname (login, invitation)
  -> Same-origin edge route (no arbitrary upstream URLs)
  -> Private origin boundary (Tunnel/VPC or mutually authenticated ingress, to be decided)
  -> FastAPI: independently verify Cf-Access-Jwt-Assertion signature, issuer, AUD, expiry, invited subject
  -> PostgreSQL transactional quota reservation (member + global)
  -> Official Supercell API using private key, outbound IPv4 allowlisted for that key
```

**Never** treat `Cf-Access-Authenticated-User-Email`, `X-Forwarded-For`, `CF-Connecting-IP`, a Player Tag, or an unverified JWT payload as identity. Header presence alone does not constitute authentication. Cloudflare documents signed JWT validation with audience, issuer and current JWKS at the team's pinned URL:
https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/

### Implemented but inactive

1. `api/src/crc_api/security/cloudflare_access.py`: rejects wrong algorithm, issuer, audience, missing/expired fields, forged signatures, unknown key ID and members absent from a nonempty subject allowlist; pins the exact `*.cloudflareaccess.com` tenant hostname and builds its JWKS URL itself. JWKS cached for at most 300 seconds by default; key rotation refreshes once. Failed refresh fails closed; tokens/claims are not copied into exceptions.
2. `api/src/crc_api/security/shared_quota.py`: receives only a **verified** Access `sub`; uses a keyed HMAC SHA-256 digest (not raw email, sub or Player Tag) for PostgreSQL counter keys. Each 60-second UTC bucket reserves **member quota and global quota within one transaction**; rejection rolls the entire transaction back.
3. `api/src/crc_api/security/private_beta.py`: composes JWT validation before shared quota reservation. It is intentionally **not imported into the local FastAPI middleware**.
4. `api/migrations/DRAFT_0001_gateway_quota.sql`: proposed table, currently applied only to disposable CI PostgreSQL. No real or live project database has been modified.
5. Tests exercise key validation/rotation, wrong claims, missing allowlist, quota rollbacks and parallel reservations against disposable PostgreSQL 17 in GitHub Actions.

### Conservative example quotas (not final product settings)

- Member: up to 12 admitted requests per fixed 60-second UTC bucket (draft).
- Global upstream: up to 90 admitted requests per fixed 60-second UTC bucket (draft; **NOT** a published Supercell quota).
- A fixed-window strategy can admit traffic on both sides of a boundary; plan safe headroom. Reservations charge for admitted attempts, including failures. Existing in-process limits remain useful only in the local app.

### Critical unfinished security gates

- [ ] Design a reviewed remote runtime and **private-origin network isolation**. Current `CRC_RUNTIME_MODE=local` **must stay enforced**, and the local loopback middleware must not be weakened or bypassed to simulate deployment.
- [ ] Implement a real same-origin edge-to-origin integration; verify the Access JWT **at the backend**, not just the edge, and prevent direct unauthorized connections to the origin.
- [ ] Configure an Access application, identity policy, audited invited tester allowlist, AUD, team domain and subject IDs via secret infrastructure, with revocation and emergency disable.
- [ ] Design a proper browser session flow on the *same protected origin*. Existing staging client uses `credentials: 'omit'` and will need a deliberate, CSRF-reviewed change for Access-protected cookie sessions, not a token in client-side JS.
- [ ] Integrate `PrivateBetaAdmission` into a dedicated remote deployment entrypoint; verify quota is charged before Supercell lookups, and fail closed if PostgreSQL or JWKS unavailable.
- [ ] Configure minimum-privilege database role, strict network policy and automated cleanup of expired quota buckets. The draft schema currently has **no running cleanup process**.
- [ ] Implement metrics, safe logs, quota reset semantics and operational alerts. Never log raw JWT, API keys or player profile JSON.
- [ ] Formalize API contract, privacy/retention, Supercell Terms and Fan Content policy review.
- [ ] Real end-to-end smoke test with owner's approved fixed outbound IPv4, authorization and rollback. No live key is needed in CI.
- [ ] Final manual mobile acceptance remains deferred until MVP feature completion, as requested by the product owner.

## Hosting candidates, research snapshot 20 November 2026

These are **indicative list prices**, not quotes or decisions; VAT, backup, snapshots, region, availability and payment constraints may change.

| Candidate | Indicative minimum | Key issue |
| --- | --- | --- |
| Cloudflare Workers Free alone | No new VM subscription | Suitable for sample/static frontend. No guaranteed dedicated outbound IPv4 for Supercell key allowlist. |
| Hetzner CX23 EU cloud VM with Primary IPv4 | approximately €5.49/month server + €0.50/month IPv4, *excluding VAT*; total roughly €5.99 before extras | Check availability, jurisdiction, payment eligibility, networking, patching, and provider policies. A Primary IPv4 is a separate billed resource; verify egress address after provisioning. |
| DigitalOcean Basic Droplet 1 vCPU/1GB | list price $6/month | 1GB may be insufficient if PostgreSQL is colocated; consider higher memory. Confirm public IPv4/egress, region and account limits before selection. |

Vendor sources:
- Hetzner June 2026 pricing adjustment: https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/
- Hetzner Primary IPv4 charge: https://docs.hetzner.com/cloud/servers/primary-ips/overview/
- DigitalOcean public Droplet pricing: https://www.digitalocean.com/products/droplets
- Cloudflare Zero Trust Free setup: https://developers.cloudflare.com/cloudflare-one/setup/

**Recommendation for first owner-approved beta:** use one small fixed-egress VM (app + PostgreSQL if resource-appropriate), Cloudflare static frontend/Access for invited testers, nonpublic origin route and shared quotas. First secure a design review and the owner's explicit recurring-spend approval. Do **not** provision anything now.

## No-change guarantees

- No production Cloudflare Access application or policy created.
- No domain, DNS, firewall, origin service, paid VM or persistent PostgreSQL database created.
- No Supercell API key supplied to this implementation, stored or exposed.
- No current Worker staging endpoint changed; `live_lookup_enabled` remains false.
- `main` remains untouched; merge requires owner approval.
