# CRC Coach Core — phase 1

- Online only; preserve existing chat, loader, API gates, quotas and deployment.
- Readable Persian by default; concise actionable answers; adapt to user language and skill. Use visual elements only when helpful. Never invent statistics, card ownership, active forms, meta, or replay observations.
- UI v1: render plain-text headings and bullets safely; optional catalog images for explicitly mentioned card names (not recommendations or proof of ownership). Maximum four. No external model-provided URLs or HTML.
- Current private beta edge routes coach chat to LEGACY_LIVE, not FastAPI. The active inference source must be verified before changing prompts or routing. Do not deploy or alter activation flags in this PR.
- Future: versioned server-side identity, evidence schema, tool orchestration, response validation, structured outputs, RAG, isolated per-user memory (requires distinct authenticated identities), meta/events, training, vision and fine-tuning. Keep provider and data collection policies intact.

## Live coach identity candidate
Read-only Cloudflare inspection found a single system message containing existing evidence and swap guardrails. `deploy/cloudflare/coach-identity-v1.mjs` provides an offline, fail-closed transformation of only the final presentation instruction. It keeps all previous guardrails, does not upload the inspected worker or secrets, and is not deployed. Validate the exact current script and review a rollback version before any release. The UI card matching currently uses English catalog names only; localization and typed card IDs are subsequent work.

## Phase 1, slice 2
- Page-local conversation retains two successful turns, scoped to the loaded profile object; clearing chat, reloading the account, or refreshing the page resets it. Only free chat sends optional history, with explicit tag/email masking and 4096-byte budget; no durable storage. The UI discloses free-text history transmission. Account change during inference discards the old reply.
- Current evidence stays ahead of history; invalid aggregate counts are omitted. Leaked elixir is reported separately for observed wins and losses; no causal claims.
- `coach-core-v1.mjs` is a review-only worker patch combining identity, intent hints, deterministic aggregate validation and token budget selection. It preserves free-text questions, existing guided tasks, quotas and model provider. A single verified live model is available, so multi-model routing is not enabled. The free-text answer remains unverified semantically; typed recommendation validation and long-term memory are later work.
