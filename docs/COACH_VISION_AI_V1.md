# Vision AI laboratory — stage 13 (2026-11-27)

## Status
This is an isolated evaluation and processing module, not a deployed image detector. Existing browser capture remains local; no route, upload, provider transport, credentials, subscription or credit changes. Actual screenshots, real labeled gameplay and provider calls are absent. Tests use synthetic observations and mock adapter responses only.

## Candidate models
Workers AI official model docs and pricing reviewed 2026-11-27:
- Gemma 4 26B A4B: https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/ — vision capable, $0.10/M input and $0.30/M output tokens.
- Qwen 3.8 27B: https://developers.cloudflare.com/workers-ai/models/qwen3.8-27b/ — vision capable, $0.45/M input and $3.20/M output tokens.
- Pricing: https://developers.cloudflare.com/workers-ai/platform/pricing/ — billing uses Neurons. These token-price equivalents exclude other costs and are not invoices. Prefer Gemma as first evaluation candidate for lower quoted rates and existing integration, not an accuracy winner. No model chosen for production until a labeled real-footage comparison. Verify the provider's actual multimodal wire schema, usage fields, retention, terms and input/image token counts before connecting.

## Pipeline
- Sample at most eight frames uniformly by index, preserving first/last when possible, from up to 120 strictly ordered local timestamps. Index spacing is not temporal interpolation; gaps may exist. For isolated evaluation the caller must supply reviewed JPEG frames (<=320px side, <=256KiB each), and explicitly approve external processing. Byte marker and declared dimension checks are only lab guardrails; before accepting untrusted uploads decode/re-encode and verify actual dimensions/content. No data URL fetch or arbitrary filename.
- Inject a trusted adapter; no default provider transport. One still image at a time, max eight calls and 384 requested output tokens per call; no retries; stop on error, unknown usage or reported output over limit. Token cap is a request limit, not a hard monetary guarantee. A provider can bill before failure/usage receipt; production reservation, global/user budgets and timeouts must precede rollout.
- Prompt is fixed; image text is not instructions. Strict JSON observation contract: battle/other/unknown screen, visible game countdown or null, visible player elixir or null, distinct visible hand cards, at most 12 visible units with card IDs, side and normalized image coordinates. Reject unrecognized IDs, malformed coordinates, unknown extra fields and nonbattle observations with game data. Every observation remains unverified.
- Evidence ledger lists timestamps, readable fields, card names and image-coordinate points, with invalid/missing/not processed states. Never infer deployment, exact sequence, spending, hidden cards, outcome or mistakes. No tactical report from sparse stills. Browser dialog shows actual number of samples, observed span and gaps, not model output.
- Evaluation supports separately reviewed ground truth and predictions: screen accuracy, timer/elixir coverage, exact accuracy across all labeled frames and MAE for read values, false reads on unknown fields, hand precision/recall/F1 and one-to-one unit matching within 0.08 normalized image distance (same card and side). No detection claim from synthetic tests.
- Run offline: node deploy/cloudflare/run-vision-eval-v1.mjs reviewed-predictions.json. Schema: version:1, reviewed:true, cards:[{id,name}], rows:[{id,reviewed:true,truth,prediction}]. Truth and prediction use the strict frame schema above; unknown means not readable. Labeling policy must distinguish invisible/uncertain from known absence; current hand/unit F1 treats the reviewed lists as exhaustive for the evaluated frame. Use only fully annotated frames for those metrics.

## Release gates
1. Consented/rights-cleared, redacted real footage with held-out by battle/device/mode, including blank screens, animations, forms, ambiguous units and hard negatives. Browser's 320px samples may be inadequate; compare resolutions before increasing cost.
2. Manual frame-level ground truth with independent review; actual model comparison and latency/usage logs. Suggested initial targets (not achieved): hand F1 >=0.90, visible elixir exact >=0.90 across labeled frames, unit F1 >=0.80, plus review of false positives, missed observations and cost. No tactical conclusions without validated temporal tracking and battle boundaries.
3. Native Android MediaProjection and iOS feasibility; post-battle only. No game automation.
4. Authenticated upload, consent, image validation/redaction, encrypted short-lived storage, deletion and per-user access isolation; explicit reserved analysis credit and idempotent job handling. Separate included analyses and additional packages only after actual unit economics. No new service enabled.


## Stage 15 — integration boundary
The private backend now contains a draft PostgreSQL job queue/credit ledger and gated API routes. The edge gateway has an exact allowlist and rejects the current shared beta session as a user identity. The migration is not applied; no processor, cleanup scheduler, credits or uploads are enabled. See COACH_VISION_INTEGRATION_V1.md.
