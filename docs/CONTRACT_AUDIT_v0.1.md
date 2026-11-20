# API contract review — bootstrap v0.1 (2026-11-20)

## Verified against design artifact

Design baseline: `OpenAPI_MVP_v1.1.yaml` (not yet imported as a checked-in normative contract). Review is limited to the local bootstrap feature branch.

| Item | Result |
| --- | --- |
| /catalog/cards, /players/{tag}, /players/{tag}/cards, /players/{tag}/battles | Implemented read-only |
| /decks/validate, /analyses | Structural validation and arithmetic only; no coaching claims |
| Battle time | Normalized Supercell compact UTC string into RFC 3339 UTC; unknown remains null |
| Tower HP | `tower_hp.king` and `tower_hp.princess`; preserve null |
| Profile deck Tower Troops | `current_deck.support_card_ids` now included |
| Card inventory count | `count` now retained when present |
| Battle classification | `eventDeck` classified as event; unknown modes never called ladder by guess |
| Player tag | Public-only; no ownership verification |

## Remaining deviations / open questions (before publishing a stable API contract)

1. Request model allows default `mode=standard` and extra fields. OpenAPI v1.1 described required `mode`, restricted enum values, and `additionalProperties: false`.
2. Invalid upstream battle times normalize to null, whereas the draft OpenAPI schema requires a non-null RFC3339 `battle_time`. Decide whether to model nullable timestamps or reject malformed upstream data.
3. `BattleParticipant.deck` may be null for incomplete upstream responses, but OpenAPI v1.1 assumes it is present and non-null.
4. Unknown or missing card costs yield null arithmetic facts; the draft schema needs explicit nullable fields and `unknown_card_ids`.
5. Analysis `player_tag` is currently accepted but does **not** fetch the player's collection or personalize recommendations; that is intentionally out of scope for this milestone.
6. A green CI run only validates mocked API data; a real live smoke test on an authorized IPv4 is still required.
7. No persistent database, caching, authentication, quota controls, or public exposure is approved.

## Exit criteria for the next milestone

- Versioned, checked-in OpenAPI definition matches the actual FastAPI app (prefer generated schema diff).
- Contract tests verify required/nullable fields and reject unsupported request shapes.
- Run live smoke test locally with `SUPERCELL_API_KEY` in an untracked `api/.env`.
- Approve backend egress IP and security controls prior to any Cloudflare integration or public access.

This document records unresolved differences rather than claiming full v1.1 conformance.
