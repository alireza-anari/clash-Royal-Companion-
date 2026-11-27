# Coach Vision + Account Identity — stage 16

## Account identity now implemented in code

The native companion now has a provider-neutral OpenID Connect Authorization Code + PKCE flow:
- GET /api/v1/auth/oidc/config returns the configured public issuer, client ID and redirect URI.
- POST /api/v1/auth/oidc/nonce returns a random nonce plus a short-lived HMAC-signed nonce token.
- POST /api/v1/auth/oidc/exchange accepts only an ID token and the nonce token. The backend verifies RS256, the exact configured issuer/client ID, signature, expiry, issued-at, nonce and kid against the pinned JWKS URL. Nonce jti values are consumed once in PostgreSQL.
- The backend derives a stable acct_ plus 32-hex identifier using a dedicated account HMAC key. It stores only HMAC-derived provider/account keys; it does not store the provider subject, email, ID token or refresh token.
- The backend issues a 15-minute app bearer token signed with a domain-separated key derived from the Worker assertion secret. The Cloudflare edge validates that token and mints its own private Worker assertion. Caller Authorization and Cookie headers are never forwarded to the private API.
- Android uses AppAuth with S256 PKCE and a Keystore AES-GCM encrypted session store. Only the app's short-lived access token and opaque account subject are stored locally. The ID token is exchanged and then discarded.

The native redirect URI is fixed in the app as com.crc.companion:/oauth2redirect. The OIDC provider must register that exact URI. The native app base URL is supplied at build time through Gradle property crcBetaBaseUrl or environment variable CRC_BETA_BASE_URL; an empty value leaves sign-in disabled.

## OIDC server configuration

OIDC remains disabled until all of these are configured together:
- CRC_BETA_OIDC_ISSUER — exact HTTPS issuer.
- CRC_BETA_OIDC_CLIENT_ID — native public client ID; must match the ID token audience.
- CRC_BETA_OIDC_JWKS_URL — pinned HTTPS JWKS endpoint; redirects are not followed.
- CRC_BETA_OIDC_REDIRECT_URI — exact com.crc.companion:/oauth2redirect.
- CRC_BETA_ACCOUNT_ID_HMAC_HEX — 32-byte stable key encoded as 64 lowercase hex characters, or the exact SSM SecureString /crc/mvp/account-id-hmac.

The EC2 instance role needs ssm:GetParameter on only the account-key parameter ARN if the key is loaded from SSM. The account HMAC key must be backed up securely and must not be rotated without an account-ID migration. The existing shared beta session remains a separate browser-only identity; it is never accepted as an Android account.

BETA_IDENTITY_EXCHANGE_SUBJECT is optional at the edge. If omitted, the Worker permits OIDC bootstrap only when all configured invite codes resolve to one identical existing beta subject. With multiple different invite subjects, configure this variable to one existing invited subject; it cannot introduce a new subject.

Mobile access tokens expire after 15 minutes. There is deliberately no refresh token yet; the user signs in again after expiry. This avoids long-lived refresh credentials before revocation and device-management flows exist.

## Vision account access and credit safety

An OIDC login creates:
- an opaque auth_accounts row and provider-key mapping;
- a one-time nonce-use record;
- a vision_account_access row with enabled=false;
- a zero-balance vision_credit_accounts row when the vision HMAC key is configured.

Signing in does not grant Vision access or credits. An owner-approved database grant must explicitly set enabled=true, granted_at and granted_by; a separate audited credit grant must add a positive balance. There is no public credit-grant, payment or admin endpoint. Static beta allowlist subjects remain supported for the existing private test account.

## Vision queue consumer now implemented in code

The backend has a private worker-only claim/complete/fail API. It accepts only a signed assertion whose subject is crc-vision-worker, and that identity is rejected on every ordinary user endpoint. The Cloudflare Worker scheduled handler:
- runs only when both BETA_VISION_ENABLED=true and BETA_VISION_WORKER_ENABLED=true, with a matching backend CRC_BETA_VISION_WORKER_ENABLED=true and processor-ready configuration;
- claims one queued job with a 15-minute lease, receives only bounded sanitized JPEG samples and has no database credentials;
- uses the Cloudflare Workers AI binding with @cf/google/gemma-4-26b-a4b-it, one request per selected still frame and at most eight frames;
- validates model output against a strict observation schema and records each result as unverified; it always sets replay_analyzed=false;
- never infers hidden cards, unseen actions, elixir spending, match outcome or tactical mistakes from a still image.

A successful completion stores the bounded observation report and deletes the source JPEG bytes in the same database transaction. A terminal provider failure or expired lease deletes image bytes and releases the reserved credit exactly once. Expired jobs erase both frames and report material. Ambiguous failures are not automatically retried because the provider may already have billed the first attempt.

The Worker schedule is every two minutes. It uses the static site catalog.json for known card IDs; this file is still a sample catalog, not yet a verified complete live catalog. Unknown card IDs are rejected by the observation validator. A full authoritative card catalog is a release prerequisite.

## Draft migrations

These migrations are code only and have not been applied:
- DRAFT_0003_vision_jobs.sql — per-account jobs, frames, credit accounts and ledger.
- DRAFT_0004_vision_worker.sql — attempt/lease lifecycle and worker indexes.
- DRAFT_0005_oidc_identity.sql — pseudonymous accounts, provider mappings, nonce replay protection and default-deny Vision access grants.

Apply them only through a separately reviewed migration process after backup/restore and retention checks. The backend requires the schema before OIDC exchange or Vision queue operations can succeed.

## Current release boundary — not activated

No OIDC provider is configured, no account HMAC key has been provisioned, and the Android app has not completed a real-provider sign-in on a physical device. No migration has been applied. No user has been granted Vision access or credits. CRC_BETA_VISION_ENABLED, CRC_BETA_VISION_PROCESSOR_READY and CRC_BETA_VISION_WORKER_ENABLED remain false/unset. The edge BETA_VISION_ENABLED and BETA_VISION_WORKER_ENABLED switches remain off. The Worker has not been deployed with its AI binding/cron changes; no model call or image upload has occurred. The Android app still has no image-upload transport or report UI.

## CI / release boundary

Backend CI covers OIDC signature/nonce/replay/account mapping, HMAC-key loading, account access gating, queue leasing, image deletion, credit consumption/refund and existing private-beta checks. Gateway CI covers OIDC bootstrap, bearer validation, origin restrictions, worker claims, model-output validation and private-only forwarding. Android CI builds the AppAuth PKCE client and tests the existing capture/manifest code. These tests do not contact a real OIDC provider, apply production migrations, grant credits, deploy a Worker, upload user images, call a live model, restart EC2 or change the live site.

## Remaining before live use

1. Register the native client with the selected OIDC provider and configure the exact issuer, client ID, JWKS URL and redirect URI.
2. Provision the stable account HMAC SecureString and its narrowly scoped EC2 ssm:GetParameter permission; configure CRC_BETA_BASE_URL for the Android build.
3. Review and apply migrations 0003–0005 through the approved backup/migration path.
4. Implement an auditable owner-only Vision access/credit grant workflow and retention monitoring.
5. Replace the sample card catalog with an authoritative current catalog and evaluate the model on real, consented test captures.
6. Run physical-device OIDC login, token expiry, capture, consent, deletion and account-isolation tests. Only then consider enabling the Worker and building upload/report transport.
