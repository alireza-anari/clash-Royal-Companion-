# CRC Coach Memory v1

## Purpose

Provide continuity across visits without inventing a server-side identity or silently storing free-text conversation. This MVP memory is opt-in and device-local. It is not a permanent server profile.

## User controls

- Default: off.
- Enable/disable per normalized Player Tag on the current browser.
- Turning off stops memory capture and stops including memory in coach requests. Previously stored data remains local until explicitly cleared.
- Clear removes the profile's stored memory and opt-in setting.
- Training focus is optional: balanced, cycle, elixir, defense, pressure, or deck balance.
- After a guided task, the player may report one of four outcomes: improved, unchanged, worse, or not tried. This is self-reported feedback, not verified match performance.

## Stored data

At most three snapshots:
- capture timestamp, source kind and selected-deck source;
- eight card IDs and bounded progression metadata (level, rarity, Evolution level and Star Level);
- up to 200 matched-tag Battle Log aggregate outcomes;
- selected-deck aggregate outcomes;
- up to three deck-pattern aggregates;
- reported elixir leakage sample/average and latest observed battle timestamp.

At most three structured feedback records:
- task category (deck, suggestions, style, overview);
- eight card IDs for the tracked current deck or validated suggested deck;
- task timestamp, pre-task same-deck aggregate outcomes, a post-task watermark, and up to 200 later observed same-deck matched-tag outcomes;
- optional feedback timestamp and one allowlisted self-reported outcome.

Not stored:
- raw Battle Log entries;
- Player Tag in the memory record value (the local-storage key is scoped by the normalized tag);
- player/opponent names, opponent tags, email, credentials, raw chat, prompts or AI answers;
- arbitrary user-written notes or model-generated personality traits.

## Data flow

1. The browser builds a compact snapshot from the current profile, selected deck and Battle Log. Only entries attributed to the supplied Player Tag are counted.
2. The browser writes it to localStorage only if the user enabled memory for that tag.
3. On the next coach request, the browser sends at most two snapshots, the chosen focus, the pending structured task (including before/after aggregates) and up to three feedback records. This is sent to Workers AI along with ordinary current request evidence; it is not written to a server database by this feature.
4. After a guided task, the browser can observe subsequent Battle Log imports. It counts only entries with a matched Player Tag, the exact eight main-card IDs for the tracked deck, and a valid battle timestamp newer than the task watermark. It advances the watermark so the same entry is not counted twice. For a suggestions task, the tracked deck is the validated server-returned one-card swap; if the player does not use it, no matching post-suggestion results will appear. Tower/support troop identity is not part of this eight-card comparison.
5. The profile page shows current-sample metrics and, when memory is enabled, pre-task and post-task counts for the tracked deck. The UI explicitly says that the comparison does not prove the player applied the suggestion or that the coach caused a result.
6. The Worker independently validates the memory version, allowed enums, eight unique card IDs, card metadata, exact outcome totals, sample bounds and timestamps. Invalid snapshots or feedback are discarded.
7. The prompt treats memory as historical and unverified. Current evidence wins. The quality layer exposes historical numbers only as a server-rendered fact selected through fact_keys.
8. The model is told that feedback is self-reported and cannot prove that a recommendation improved performance.

## Identity and trust limitations

- A Clash Royale Player Tag is a public lookup identifier, not proof of ownership.
- The current private beta edge has a shared default subject when only one beta subject is configured. It is not sufficient for safe cross-device server-side per-user memory.
- localStorage is not encrypted and is available to scripts running on the same origin. Do not store sensitive information in it. The user can clear the data from the Coach tools menu or browser site-data controls.
- Device-local memory does not sync across browsers/devices and is lost if browser storage is cleared.
- Memory is never enabled by code migration; it requires the player to switch it on.

## Retention and bounds

- Three snapshots maximum; three feedback records maximum; one pending task with at most 200 post-task same-deck observations.
- Snapshot input: 8 cards, 200 battle aggregates, 3 deck patterns.
- Coach request body remains bounded by the existing 4096-byte payload limit. If needed, older memory snapshots are dropped before current evidence; memory is omitted before current deck/battle facts are removed.
- Turning memory off pauses capture and transmission; use the explicit clear action to erase it.

## Test coverage

- Browser-local store: default off, per-tag isolation, retention cap, duplicate snapshot suppression, pause/clear, invalid tags, malformed snapshots and feedback enum rejection.
- Request payload: no Player Tag, free text, raw battles or arbitrary fields in memory.
- Worker: independent schema validation, exact outcome totals, and allowlisted current/suggested-deck tracking target.
- Practice follow-up: only newer exact-eight-card matched-tag battles are counted; timestamps advance to prevent duplicate counting; the dashboard labels the comparison as descriptive rather than causal.
- Quality: historical facts appear only when selected and self-reported feedback is labelled as such.
- Production Worker and authentication configuration are unchanged.
