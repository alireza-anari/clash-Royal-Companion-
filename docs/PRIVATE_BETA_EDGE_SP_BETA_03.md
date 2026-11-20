# SP-BETA-03 — Cloudflare Access + VPC Service edge and browser session

**Status: source code and automated tests only. NOT DEPLOYED.**
- Public stage remains https://crc-mvp-stage-20261120.alirezaanari117.workers.dev/ with sample-only lookup.
- Backend private-beta factory exists on `feat/backend-bootstrap`, Draft PR #2; this edge code is on `feat/mvp-frontend`, Draft PR #4.
- Do not merge `main`, purchase hosting, modify DNS, enable Access or route to live Supercell until the owner approves and operational gates pass.

## Selected architecture

```text
Invite-only tester's browser
  | Access-managed CF_Authorization cookie (never read by frontend JS)
  v
Distinct HTTPS beta hostname, protected by Cloudflare Access on ALL routes
  | Worker with static assets run_worker_first
  | GET / -> ASSETS binding + beta-session.js injection
  | GET /api/v1/capabilities + /catalog/cards + /players/%23TAG/snapshot
  | route allowlist, origin/host checks, no-store, no arbitrary proxy target
  v
Workers VPC Service binding: PRIVATE_API (one pinned internal host+port)
  | over Cloudflare Tunnel, no public backend listener
  | passes ONLY signed Cf-Access-Jwt-Assertion and Accept
  v
Separate private FastAPI beta gateway (PR #2)
  | verify RS256 signature, issuer, Access AUD, exp, invited subject
  | reserve per-member + global quotas in PostgreSQL
  v
Official Supercell API from owner-authorized fixed outbound IPv4
```

### Components in this PR

- `deploy/cloudflare/beta-edge-worker.mjs`: an **undeployed** ESM Worker for a distinct protected beta hostname. Uses only `env.PRIVATE_API.fetch(new Request(fixedHostAndAllowlistedPath))` for API. It requires `env.ASSETS` for static files. It does **not** call public `fetch()` to an arbitrary origin.
- `site/beta-session.js`: injected only by the protected beta Worker into HTML. Browser `fetch()` uses `credentials: 'same-origin'` so Cloudflare Access handles its session cookie. It never accesses `document.cookie`, parses a JWT, stores a service token, or adds authentication headers itself.
- `site/app.js`: chooses the beta transport only if injected; displays reauthentication after expired login. The login action is a **user-clicked top-level reload**, letting Cloudflare Access trigger login normally (no magic link, password form, or token handler invented).
- `site/backend-client.js`: meaningful messages for missing session, invitation failure, JWT expiry and shared quotas. The public staging Worker still returns `live_lookup_enabled:false`.
- `deploy/cloudflare/beta-edge.test.mjs` and `site/beta-session.test.mjs`: check path allowlist, method restrictions, header forwarding, origin/Host denial, oversized JSON, no-store, missing binding, cookie-mode fetch and explicit re-login.
- `site/sw.js` is **not registered in the beta browser mode**; the beta edge returns 410 for `/sw.js`. Deploy on a new beta-only hostname that has never had a public PWA service worker registered.

## Path and privilege controls

The only allowed backend paths are:
- `GET /api/v1/capabilities`
- `GET /api/v1/catalog/cards`
- `GET /api/v1/players/%23TAG/snapshot?limit=N` with N = 1..25 and canonical valid Tag.

Everything else under `/api/` is 404 or 405. The Worker strips user-supplied `Cookie`, `Authorization`, `X-Forwarded-For`, `X-CRC-Internal-Token`, user-email claims and other headers. It explicitly passes only `Accept` and the `Cf-Access-Jwt-Assertion` header. **The JWT header itself is not trusted by the Worker; it must be independently validated in the Python beta gateway.** A nonempty header is never authentication.

Response headers strip upstream `Set-Cookie` and never expose bearer tokens. API responses are bounded to 512 KiB JSON and marked `Cache-Control: no-store`. Origin redirects are rejected (502), while numeric `Retry-After` values from 429 quota responses are preserved within a safe bound. The beta HTML is noindex, uses a restrictive CSP, and omits the installable PWA manifest.

## Configuration sketch (NOT a deployable config, no real resource IDs)

After approved provisioning, bind one specific **VPC Service** to the Worker:
- Binding name: `PRIVATE_API`
- Service ID: provisioned Cloudflare Connectivity Directory VPC Service ID, pinned to the private API host and port behind a Tunnel
- Binding name: `ASSETS`, directory: `site/`, and `assets.run_worker_first: true`
- Environment variable `BETA_ENABLED: "true"` (enable only after controls are verified)
- Environment variable `BETA_HOSTNAME`: exact new, Access-protected beta hostname (e.g. `beta.example.com`)
- Worker entrypoint: `deploy/cloudflare/beta-edge-worker.mjs`

Do not create generic VPC Network access when a single VPC Service will suffice. Do not expose the origin host/port publicly. The Worker uses `http://<configured-beta-hostname>/...` solely to construct the fixed Host and path; VPC **Service** bindings route to their configured service ID's actual private host and port, not to the hostname as an arbitrary Internet destination. Verify this behavior against the current API during integration.

Do not enable the production Worker on its `workers.dev` or preview URL without the same Access policy. Prefer disabling alternate routes; reject requests to any hostname other than the configured beta hostname. The existing public sample-only Worker must remain a separate deployment and must not inherit the beta's bindings.

## Validation / mandatory real-world checks before beta activation

1. Verify Access is enabled for the **whole** beta hostname, not only `/api`, all preview or alternate routes covered/disabled, with only invited test accounts.
2. Confirm Cloudflare forwards a signed `Cf-Access-Jwt-Assertion` to Worker requests using Static Assets. The internal Assets router can omit `ctx.access`; this implementation intentionally relies on an assertion header validated **again** by FastAPI. If missing, requests fail closed; do **not** weaken gateway authentication to make it pass.
3. Test same-origin Access cookie login/expiry by genuine browser navigation and signed-in `fetch`; confirm no token is sent to JavaScript. Browser `credentials: 'omit'` is not suitable for this separate cookie-based mode.
4. Confirm the VPC Service can reach ONLY the intended private origin; verify its Host header and SSL/Tunnel parameters, absence of public ingress, and that the beta FastAPI service validates issuer, AUD and invited subject.
5. Apply draft quota migration only to an approved, private PostgreSQL instance with least privilege, TLS, cleanup and retention policy. Existing CI PostgreSQL is disposable and does not persist.
6. Confirm Supercell's key is allowlisted to the origin VM's **real fixed outbound IPv4** and is never transmitted to the Worker or browser.
7. Run unauthorized/malformed request smoke tests across **real** Access, VPC, and origin; confirm fail-closed responses during DB/JWKS/Access outages and effective rate budgets.
8. Ensure Fan Content/API terms, observability, emergency disable and cost controls are approved. Complete manual mobile acceptance after MVP feature completion.

## Sources consulted (November 2026)

- Cloudflare [Workers VPC Services](https://developers.cloudflare.com/workers-vpc/configuration/vpc-services/) — binding pinned to one registered private target; VPC beta availability and requirements may change.
- Cloudflare [Workers VPC binding API](https://developers.cloudflare.com/workers-vpc/api/) — `env.PRIVATE_API.fetch()` private-service calls.
- Cloudflare [Access for Workers](https://developers.cloudflare.com/workers/configuration/cloudflare-access/) — protect workers/hostnames; Static Assets router caveat for `ctx.access`.
- Cloudflare [Validate Access JWTs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/) — signature and issuer/AUD validation of `Cf-Access-Jwt-Assertion`.
- Cloudflare [Workers Static Assets routing](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/) — `run_worker_first` and explicit `ASSETS` binding.

**Remaining blocker:** no private origin, Access app, approved domain, database or fixed-egress VM exists. Therefore this branch supplies testable code, NOT a live beta site.
