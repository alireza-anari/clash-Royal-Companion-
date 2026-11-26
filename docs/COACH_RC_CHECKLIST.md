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
