# Meta Data Pipeline

## Purpose

The Cloudflare Worker collects a rolling Ranked sample from the official Clash Royale API and publishes a versioned, read-only meta snapshot. The current UI fallback remains available if collection has not completed or the upstream API is temporarily unavailable.

## Data source and method

- Seed cohort: up to 200 players from `GET /locations/global/pathoflegend/players?limit=200`.
- Per player: `GET /players/{playerTag}/battlelog`.
- Include only battle rows where `type === "pathOfLegend"`.
- Require a 1v1 battle with exactly eight cards on both sides.
- Count both decks, but deduplicate each battle by battle time and the two player tags.
- Win rate is wins / (wins + losses); draws and unknown outcomes are excluded from the denominator.
- Usage is deck appearances / all observed deck appearances.
- The sample covers the recent public battle logs returned by the API. It is not described as a fixed seven-day window or as the entire Ranked population.

The API token stays in the existing Cloudflare secret binding and is sent only from the Worker to the RoyaleAPI proxy configured for the token's allowlisted IP. No player tags are published in the snapshot.

## Scheduling and free-tier safeguards

- Cron expression: `*/2 * * * *` (UTC).
- Refresh interval: 12 hours; the two-minute trigger only advances an active job or checks whether a refresh is due.
- Batch size: 32 player logs per invocation.
- Concurrency: 4 outgoing requests.
- This keeps each scheduled invocation below the Workers Free 50-subrequest limit, including the initial leaderboard and card-catalog requests.
- KV job state is written after every batch. The next batch runs at least two minutes later to allow KV propagation.
- A failed refresh never overwrites the last valid snapshot.
- Publish only when at least 65% of leaderboard players were read, at least 200 unique Ranked battles were observed, and at least 400 deck appearances were counted.
- Failed upstream requests are summarized by safe error code only; tokens and raw player tags are never logged.

## KV keys

| Key | Purpose |
| --- | --- |
| `meta:current` | Latest valid snapshot |
| `meta:previous` | Previous pipeline snapshot |
| `meta:status` | Refresh state and last successful run |
| `meta:job` | Temporary chunked collection state |
| `meta:catalog` | Latest official card catalog metadata |
| `meta:history:<timestamp>` | Snapshot history; 90-day retention |

The namespace is created with EU jurisdiction and bound to the Worker as `META_KV`.

## Worker integration

`src/meta-worker-integration.js` owns the read-only HTTP routes and delegates the scheduled event to `src/meta-pipeline.js`. The deployed Worker imports this adapter; the public routes never invoke a refresh directly.

## Read-only endpoints

- `GET /api/v1/meta/current` — latest valid snapshot.
- `GET /api/v1/meta/status` — refresh progress and freshness.
- `GET /api/v1/meta/catalog` — latest official card catalog metadata.
- `GET /api/v1/meta/history?limit=10` — recent stored snapshots (maximum 20).

No public endpoint can trigger a refresh or change stored data.

## Snapshot schema

The snapshot includes `generated_at`, sample period, cohort size, successful/failed player counts, unique battle count, deck appearances, top decks, card usage, card trends versus the previous pipeline snapshot, and archetype summaries.

The first successful pipeline run establishes the baseline. Rising/falling card trends become available after the next successful run.
