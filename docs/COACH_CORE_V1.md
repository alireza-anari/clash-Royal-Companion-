# CRC Coach Core — phase 1

- Online only; preserve existing chat, loader, API gates, quotas and deployment.
- Readable Persian by default; concise actionable answers; adapt to user language and skill. Use visual elements only when helpful. Never invent statistics, card ownership, active forms, meta, or replay observations.
- UI v1: render plain-text headings and bullets safely; optional catalog images for explicitly mentioned card names (not recommendations or proof of ownership). Maximum four. No external model-provided URLs or HTML.
- Current private beta edge routes coach chat to LEGACY_LIVE, not FastAPI. The active inference source must be verified before changing prompts or routing. Do not deploy or alter activation flags in this PR.
- Future: versioned server-side identity, evidence schema, tool orchestration, response validation, structured outputs, RAG, isolated per-user memory (requires distinct authenticated identities), meta/events, training, vision and fine-tuning. Keep provider and data collection policies intact.
