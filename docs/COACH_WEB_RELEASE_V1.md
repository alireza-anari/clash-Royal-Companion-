# Stage 20 — web Coach release preflight (2026-11-27)

## Verified read-only evidence
- Stage 19 source head 0fab3a350efa1097425edd33eb4f151cff4ef580: visual/gateway/browser CI 45961147178 and Android CI 45961147170 both completed successfully.
- Cloudflare Primary account read access restored. Located existing workers crc-mvp-live-test-20261123 and crc-private-beta-gateway; no new resources created.
- Legacy script download returned multipart modules meta-pipeline.js, meta-worker-integration.js and worker.js. Extracted worker.js in memory and applied the exact stage-19 GitHub patchCoachCore composition (identity, lexical knowledge, quality, router, meta, events). All unique anchors accepted. Source length 296081 characters; candidate length 350671 characters. Candidate contained identity, quality, router, meta and event markers. The original remains unchanged. No source or binding secret values were exported or committed. This is an anchor/composition test, not a deployed runtime or syntax validation of the complete private candidate.
- Legacy binding inventory includes AI, AI_GLOBAL_RATE, AI_RATE, PLAYER_RATE, META_KV and SUPERCELL_API_TOKEN (secret name only). COACH_FAST_MODEL not configured. Current script contains the Gemma 4 26B model ID.
- Gateway binding inventory includes ASSETS, LEGACY_LIVE, PRIVATE_API, existing session/assertion/invite secret bindings and beta configuration. No Vision activation bindings observed. Existing gateway source contains the LEGACY_LIVE forwarding path.

## Observed rollback references (read-only, recheck immediately before any deployment)
| Worker | Latest listed deployment | Version (100%) |
|---|---|---|
| crc-mvp-live-test-20261123 | c9e4c54e-6dc0-4287-88d4-98a6bba2d15e | 690453ba-6aac-4a28-9951-61ada639ede0 |
| crc-private-beta-gateway | ad1ff598-4af9-44d3-ab3f-51cabef936a0 | a0b9d034-f7c2-4a3c-abd0-fc86ef5b07fe |

Deployment list metadata and downloaded latest script are separate observations; confirm exact active version content and rollback compatibility before changing anything. Rollback references do not guarantee restoration of external state.

## Release gates
1. Re-read active version and exact module content; compare source before applying any transformation. Run Node syntax validation of full candidate modules, not only the synthetic fixture. Preserve unrelated modules, bindings, compatibility and rate limits.
2. Separate web Coach release from Android Vision; keep the Vision flags and optional fast model off. Do not activate unavailable global meta snapshots.
3. Stage updated web assets and patched legacy inference in an isolated authorized release path with current authentication and existing private backend boundaries; do not replace secrets or rebuild infrastructure.
4. Run the authorized real-player smoke: actual profile/deck and eight card roles, recent matched-tag outcomes, owned-options swap, insufficient evidence/unsupported replay abstention, profile-switch isolation, and loader/error recovery. Verify quota enforcement and actual usage. No real player lookup, live chat, or billable call was executed in this preflight.
5. Confirm deployed version and rollback target immediately before any rollout. Keep prior versions available. Require successful staging smoke before promoting.

Private backend repository access and exact Vision job contract are not resolved by restored Cloudflare access. No deployment, migration, credential, activation, quota, billing or production change was made.
