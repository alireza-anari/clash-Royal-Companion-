# CRC AI Coach — private beta preparation (not deployed)

Status: **Code-only, disabled by default.** No public Cloudflare Worker is connected
to external inference. No AWS command, model request, database migration, payment
or new cloud resource is performed by these source files.

## Fixed provider allowlist

- Primary: `google/gemma-4-31b-it:free`
- Fallback only on temporary 5xx/network failure:
  `google/gemma-4-26b-a4b-it:free`
- HTTP endpoint: `https://openrouter.ai/api/v1/chat/completions`
- Maximum generated tokens per call: 400
- No retry of HTTP 429 (free account quota); no paid-model fallback
- Every request sets OpenRouter `provider.data_collection=deny`; endpoints that collect/train on request data are excluded. If no eligible endpoint is available, the request fails closed rather than weakening the privacy rule.
- This is a provider-routing control, not a guarantee that the user should submit personal information; consent and data minimization still apply.
- Both free model IDs and their eligible providers must be rechecked before eventual activation.

## Private API contract

`POST /api/v1/coach/chat` is only installed inside `create_beta_app()`.
It requires existing signed Cloudflare Access JWT, allowed invite subject,
exact Host/Origin checks and shared PostgreSQL request quota, plus:

1. `CRC_BETA_AI_ENABLED=true` (defaults to false)
2. `CRC_OPENROUTER_SSM_PARAMETER=/crc/mvp/openrouter/api-key` points to the
   exact eu-north-1 SecureString. The EC2 instance role must have permission
   to read/decrypt it via `ssm:GetParameter`. The backend uses AWS CLI
   to fetch it only when AI is enabled, captures the output in memory and never
   writes a plaintext secret file.
3. JSON `consent_to_external_ai: true` (explicit user action; not inferred)
4. Strictly validated question (3–280 chars) and optional aggregate-only
   `deck`/`battles` values (unknown JSON fields are rejected)
5. An atomic daily PostgreSQL AI reservation before ANY OpenRouter call

A daily AI request budget is 6 per verified beta member and 18 total across
the private beta per UTC day. With at most two free-model calls per accepted
request, this caps requests originating in this gateway to 36/day, lower than
a typical zero-credit OpenRouter account's 50/day allowance. Other uses of the
same OpenRouter account may still consume its allowance.

**No raw Battle Log, replay frames, player name, tag or timestamps are fields
in the API schema**. The manually typed question is sent to the provider,
so the UI must warn users not to include personal information and must obtain
consent before the request. The source of any submitted aggregate is labeled
*client-submitted/unverified*. This is NOT an identity-verification mechanism.

## Manual activation prerequisites (not done yet)

1. Complete private beta security/egress and same-origin gateway review.
2. Review, approve, and separately apply
   `api/migrations/DRAFT_0002_ai_daily_budget.sql` on the **private** database.
   A missing quota table fails closed with `AI_BUDGET_UNAVAILABLE`.
3. Create a limited OpenRouter API key at
   https://openrouter.ai/settings/keys and store it as a SecureString in
   AWS SSM `/crc/mvp/openrouter/api-key` in `eu-north-1`.
   Never send the key in chat, commit it, put it in a public Cloudflare
   Worker variable, or log it in GitHub Actions.
4. Give only the CRC EC2 instance role `ssm:GetParameter` on that
   specific parameter (the AWS-managed `alias/aws/ssm` key needs no
   extra customer KMS permission for this setup). The runtime process
   requires an available AWS CLI and instance profile credentials.
   Configure `CRC_OPENROUTER_SSM_PARAMETER` and leave
   `CRC_BETA_AI_ENABLED=false` until authentication, quotas, privacy
   policy, consent UI and provider behavior are all reviewed.
5. Enable only for invited beta members. Validate an approved request
   with mock data first, then controlled live tests.
6. Document a kill-switch: `CRC_BETA_AI_ENABLED=false` + restart isolated
   beta app (NOT the existing public Cloudflare site).

## Failure and safety behavior

- Missing key, disabled switch: 503, no provider call
- Missing consent: 403, no provider call
- Invalid or personally identifying raw JSON fields: 422, no provider call
- Missing/unavailable daily budget: 503, no provider call
- Exhausted daily budget: 429, no provider call
- OpenRouter 429: stop without attempting fallback
- Temporary upstream failures: at most one other *free* model request
- OpenRouter response bodies, token values, user questions and raw upstream
  exception messages are not returned in error responses.
- Replay/video analysis and exact tactical mistake claims are not supported.
- Do not change existing main branch, public sample-only Cloudflare Worker,
  access gateway, PostgreSQL schema or FastAPI service by following this file.
