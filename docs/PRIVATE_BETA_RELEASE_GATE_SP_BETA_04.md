# SP-BETA-04 — Two-switch beta release gate and quota retention

**2026-11-21. Source-level readiness only. No live infrastructure deployed.**

## Why this exists

The earlier beta API could announce `live_lookup_enabled: true` immediately after Worker authentication, database, and Supercell configuration became available. That creates a risky activation path during early deployment. The backend now has its own independent, **default-off** live lookup switch.

## Independent switches

| Layer | Switch | Default | Effect |
| --- | --- | --- | --- |
| Beta app factory | `CRC_BETA_RUNTIME_GATE` | unset | The separate protected beta app refuses to start without explicit approval marker. Not a secret, not proof that spending was approved |
| Beta Worker | `BETA_ENABLED` | absent | Cloudflare beta Worker denies every request if not exactly `true` |
| Beta API outbound | `CRC_BETA_LIVE_LOOKUP_ENABLED` | absent/false | Worker authentication and PostgreSQL may operate, but cards and player snapshots return 503 `BETA_LIVE_LOOKUP_DISABLED`; capabilities honestly reports `live_lookup_enabled:false` |

The third switch must be exactly the lowercase string `true`. `1`, `TRUE`, `yes` and missing values all remain off. Even with a Supercell key configured, the app will not contact Supercell while this switch is off. With this switch off, Supercell credentials are not needed to construct the protected beta app.

**Release sequence to consider (not executed):**

1. Provision approved invite-code authentication, private VPC Service, fixed-egress VM, PostgreSQL, DNS and secrets infrastructure only after owner authorization; leave both worker and live API disabled.
2. Validate real Worker assertion forwarding, authenticated host, gateway quotas, PostgreSQL certificate verification and private-origin isolation. The protected beta can be brought up with `CRC_BETA_LIVE_LOOKUP_ENABLED=false`; this cannot make Supercell calls.
3. Register and validate the VM's real outbound IPv4 for the official Supercell API key. Validate quota budget and emergency disable procedures.
4. Only with all gates passed and explicit owner approval, change `CRC_BETA_LIVE_LOOKUP_ENABLED=true` on the **backend only**, and then enable the separate beta Worker. The public Cloudflare sample site must stay separate.
5. Complete real browser, revocation and live-key smoke checks before inviting real testers.

## PostgreSQL privacy and retention

`api/src/crc_api/security/quota_cleanup.py` provides `prune_expired_quota_windows()`. It deletes up to 500 expired rows per call (configurable bounded range 1..1000), older than a default three-hour retention threshold, using `FOR UPDATE SKIP LOCKED` and a bounded SQL batch. It has no logging of subject keys, JWTs, or Player Tags.

**This cleanup is not yet scheduled or run.** Merely adding a deletion function does not establish an actual retention SLA. Once a private database exists, an operator-approved scheduled maintenance job must call it periodically, monitor failures and verify that counters are actually removed. Application admission must not rely on periodic cleanup being successful.

To deploy with the BetaConfig environment parser, PostgreSQL DSN **must** specify `sslmode=verify-full`, e.g. `postgresql://<user>:<password>@db.private.example:5432/crc?sslmode=verify-full`. This is an illustrative placeholder, not a working secret. Verify the database CA and hostname match. Plaintext, `require`, `verify-ca` and duplicate/malformed SSL modes are rejected before startup. Connection tests still use disposable CI PostgreSQL through an injected test pool and never need to connect to a production database.

## Automated verifications

- `api/tests/test_beta_gateway.py`: signed invite session with fake Supercell responses and PostgreSQL mocks; verifies that a configured invite/session auth+quota system **does not call Supercell** with live lookup off, even without a provider key; explicit opt-in validation; rejects insecure PostgreSQL DSNs.
- `api/tests/test_quota_cleanup.py`: invalid retention inputs are rejected, PostgreSQL deletes only expired buckets, preserves recent counters and respects batch limits.
- GitHub CI tests the complete Python suite and builds the separate network-isolated local Docker artifact; it does **not** deploy a live beta or verify a real private origin.

## Hard blockers left

- No approved host or fixed outbound IPv4; no production Access app/policy, VPC Service/Tunnel or private PostgreSQL instance exists.
- No production quota cleanup job or real DB TLS certificate setup exists.
- API schema and live Sup­ercell responses need contract checks with a genuine authorized upstream.
- Worker invite/session revocation and HMAC assertion end-to-end tests, browser manual acceptance, account privacy review and owner approvals are pending.
- `main` and existing sample-only Cloudflare staging remain untouched.

**Do not infer that successful isolated CI tests mean the project is deployed or ready for real user accounts.**
