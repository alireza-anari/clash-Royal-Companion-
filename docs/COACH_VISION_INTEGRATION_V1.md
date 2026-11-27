# Vision integration v1 — stage 15

## What exists in code
- Android AccountSession interface requires a signed-in per-account identity and a short-lived access token. VisionUploadPackage creates a bounded in-memory JSON request only after the user explicitly confirms both image upload and external-AI processing. It selects at most eight post-battle frames and never places the account subject or token in the JSON body.
- The Cloudflare beta gateway has an exact route allowlist for capability, create-job, status and cancel operations. Upload JSON is limited to 3 MiB. Create and cancel require same-origin requests; the Worker never forwards browser cookies or caller Authorization headers to the private API. A short-lived Worker assertion is minted from the verified session.
- The gateway requires BETA_VISION_ENABLED=true and a subject matching acct_ followed by 32 lowercase hex characters before it forwards any job request. The current automatic beta session subject is shared and does not match; the local capability response therefore remains disabled with ACCOUNT_IDENTITY_REQUIRED.
- The private FastAPI backend has account-scoped capabilities and job routes. It requires a verified Worker assertion, an explicit allowlisted account subject, both consents and a ready-processor flag. Images are strict-base64 decoded, fully opened with Pillow, dimension checked, re-encoded as JPEG to remove metadata, then stored as bounded PostgreSQL BYTEA frames.
- The draft PostgreSQL queue schema supports idempotent client request IDs, per-account one-credit reservation, a ledger, account-scoped status reads and cancellation. A queued cancellation deletes frame bytes and releases the reservation exactly once. Job responses never return image bytes or raw account IDs.

## API contract
- GET /api/v1/vision/capabilities
- POST /api/v1/vision/jobs
- GET /api/v1/vision/jobs/{uuid}
- DELETE /api/v1/vision/jobs/{uuid}

Create-job JSON fields: client_request_id (UUID), consent_to_upload (boolean true), consent_to_external_ai (boolean true), and 1–8 ordered frames. Each frame has at_ms, mime=image/jpeg, width, height, and data_base64. The server rejects extra fields, duplicate/out-of-order times, non-JPEG data, mismatched dimensions, invalid JPEGs, more than 256 KiB/frame or 2 MiB total, and captures beyond four minutes / 320px side. The Worker accepts at most 3 MiB encoded JSON.

The backend derives a keyed HMAC account key from the verified opaque account subject. It never trusts a Player Tag as identity. Idempotency is scoped to the account; a repeated key with different image content returns conflict. One credit is reserved atomically before enqueue. No public credit-grant or payment endpoint exists.

## Deliberately not activated
All switches are off or unset:
- Worker: BETA_VISION_ENABLED (absent means off)
- Backend: CRC_BETA_VISION_ENABLED=false
- Backend: CRC_BETA_VISION_PROCESSOR_READY=false
- Backend: CRC_BETA_VISION_ALLOWED_SUBJECTS empty
- Backend: CRC_BETA_VISION_HMAC_HEX unset

The draft migration api/migrations/DRAFT_0003_vision_jobs.sql is not applied. The job rows carry a 24-hour expiry timestamp, but no cleanup scheduler exists yet. The PostgreSQL queue has no running consumer/model adapter, so processor readiness must remain false. No account credits are granted. Android has no Internet permission, no OIDC implementation and no HTTP transport. The manifest builder is tested but does not send anything.

## Required before any live upload
1. Add a real per-user OIDC account identity and verified Android sign-in/device linking (PKCE or an approved device authorization flow). The existing shared automatic beta subject and Player Tag must never be accepted as account identity.
2. Implement and deploy a bounded queue consumer with a real, evaluated vision model adapter, retry/timeout policy, per-user/global budgets and measured unit costs. Only then may processor readiness be enabled.
3. Apply the reviewed schema through a separate migration process, grant credits through an owner-only auditable path, and add retention/deletion cleanup plus operational monitoring before storing user images.
4. Implement mobile HTTPS transport with short-lived scoped tokens, TLS, token refresh/revocation, retry/idempotency and user-visible upload status.
5. Run real-device Android tests for consent, selected-app-only capture, process death, upload cancellation, battery and image quality; then build the website report UI and test account isolation end to end.

## CI / release boundary
The Android debug build and JVM tests cover the in-memory manifest builder. Backend CI covers request validation, account-scoped routes, PostgreSQL credit reservation/idempotency/cancellation and existing private-beta checks. Gateway CI covers exact routes, origin, consent, shared-subject denial and private-only forwarding. CI does not apply the draft migration to production, upload real images, call a model, grant credits, deploy a Worker, restart the backend or change the live site.


Mobile auth boundary: the current edge Worker accepts the browser's HttpOnly session cookie and mints a private Worker assertion. It does not accept Android bearer tokens. The Android AccountSession interface is only a contract; a future OIDC/device-link exchange must verify the token at the edge and mint a scoped assertion. Passing a caller-supplied Authorization header through to the private API is not allowed.
