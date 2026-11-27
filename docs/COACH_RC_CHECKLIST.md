# Coach RC readiness checklist

Existing draft PR #12; no merge or deployment.

## Verification gates
- [ ] Reproducible public Worker bundle (build-site.mjs --check).
- [ ] Unit tests and 60-case corpus validation, including regressions for duplicates, contradictory timestamps, pre-task evidence, sample bounds, profile isolation, pending task preservation and training checkpoint.
- [ ] Mobile (390×844) and desktop (1440×900) mock browser smoke, including profile progress and default-off memory.
- [ ] Verify private staging Worker transformation against deployed script and bounded end-to-end real player lookup/Coach request using authorized credentials.
- [ ] Verify live session/subject isolation, quota guards, model binding, billing/usage and rollback target before merge/deploy. Static review is not a production audit.

## Existing limits
- Device-local opt-in memory, not authenticated server memory or cross-device sync.
- Matched-tag dated battle summaries, not complete account history or replay. Main-card matches do not establish identical support/tower troop, mode, or causal improvement.
- Five known results is a practice review checkpoint, not statistical significance. Local drills need no model calls.
- Candidate default Gemma; 240/720 completion-token budgets. Optional GLM requires explicit config; at most one fallback. Request limit 4096 bytes; beta edge uses short-lived signed assertions. Verify live quota and usage separately.
- Collection Level is an estimate based on available profile fields. No inferred shards, gold, unlocks or ownership. Live meta, event schedules, replay analysis and fine-tuning remain future features.
- No new secrets, database, billing service or provider. Offline CI does not perform paid inference.


## Stage 19 — split release candidates and shared report contract (2026-11-27)
Do not treat the Android Vision alpha as a prerequisite for the text Coach web private beta. Neither track is approved for deployment by this checklist.

### Track A: web Coach private beta
- [x] On stage 18 head 3798e0f, visual/gateway/browser CI 45950218348 passed.
- [ ] Re-run checks on final release commit and verify the current deployed legacy Worker and exact composed Coach transformation; do not assume review-branch code is live.
- [ ] Authorized staging smoke: actual player snapshot, chat with deck/battle evidence, ownership-constrained swap, unsupported question abstention, cross-profile isolation, quotas, usage and rollback.
- [ ] Keep optional model, real global meta and unavailable live event evidence appropriately gated. No invented live data.

### Track B: Android Vision (not release-ready)
- [x] Stage 18 Android build/JVM CI 45950218467 passed.
- [x] Stage 19 source changes: shared synthetic Worker result fixture asserted by existing mock Worker test and decoded by native JSON adapter test. Original selected timestamps are retained immutably in prepared upload. Reusable report view supports JSON decoding. The adapter bounds size/depth/structure and delegates evidence validation; it is not a job envelope or authorization parser.
- [ ] Verify stage 19 CI (new test-only org.json dependency, Android platform JSON behavior and UI/device smoke).
- [ ] Obtain access to private backend and confirm exact job, credit, cancellation, expiry, status and result envelopes plus account authorization. No client submit control or job-report mounting until verified.
- [ ] Complete account-bound recovery/idempotency, explicit reviewed-image dual consent, credit grants, OIDC configuration, migrations, retention and cross-account tests.
- [ ] Replace sample catalog with authoritative reviewed catalog; benchmark real consented redacted samples. Do not infer tactical mistakes from stills.
- [ ] Physical-device staging end-to-end flow, with paid inference separately approved. Production feature switches remain off; no deployment, config or migration changed in stage 19.

### CI scope
Web and Android mock tests are independent of the private database and production. A passing shared fixture test verifies the inner Worker-to-client report contract only, not successful real upload, server persistence, authorization, account credits, provider accuracy or full replay analysis.
