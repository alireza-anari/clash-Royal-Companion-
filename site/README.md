# Clash Royale Companion — website staging v0.2

## Current staging

https://crc-mvp-stage-20261120.alirezaanari117.workers.dev/

This branch contains a mobile-first Persian frontend and a **separate Cloudflare Workers sample-only runtime**. It does not replace the modular FastAPI backend on the separate \`feat/backend-bootstrap\` branch.

## Functioning features

- Dashboard and persistent local card deck selection (eight slots)
- 120-card visual snapshot with image URLs, card search, cost filters and details; historical snapshot, not a live official catalog
- 12 provisional card-coaching guides, shown with explicit draft/expert-review limitations
- Deterministic deck arithmetic and evidence-labelled, informational findings
- Profile import of official Supercell Player JSON via browser-only File API
- Battle Log import, verified player-tag attribution when available, safe event/unclassified handling, summary rows, known outcomes and reported Elixir Leaked.
- Repeated-deck grouping (card order independent, tower troop distinguished when present) and selection of an observed deck for arithmetic analysis.
- Ambiguous 2v2 or nonmatching tag outcomes are marked unknown; no implicit assignment to the first player.
- Planned future Community and Tournament screens clearly not advertised as available
- Static-only service worker and install metadata for a PWA-like mobile experience; runtime browser installability not yet assessed
- No player data stored on server, no Supercell token in frontend and no live Supercell lookups
- Sample catalog populated from **public card metadata only**, extracted from an official API response provided for the project. No player tag, name, card ownership count, levels or account identifiers are in the seed.

## Development architecture

- \`site/index.html\`, \`styles.css\`, \`app.js\`, \`catalog.json\`: plain static files, no new dependency required for this temporary Worker-hosted UI.
- \`deploy/cloudflare/worker-runtime.js\`: stateless sample-only routes and assets.
- \`deploy/cloudflare/build-site.mjs\`: reproducible bundle to \`deploy/cloudflare/mvp-worker.js\`.
- \`node --test site/mvp.test.mjs site/battle-insights.test.mjs\`: pure HTTP handler tests and source syntax checks.
- \`feat/backend-bootstrap\`: Python FastAPI (not deployed). Production architecture target remains Next.js + FastAPI + PostgreSQL; this stage is **not** a completed Next.js build.

## Deployment / operator rules

The Cloudflare stage was deployed through the connected account using its API. Code pushes to GitHub do not automatically update Cloudflare; rebuild and redeploy deliberately. No Cloudflare credentials are committed.

Production blockers:
- Live Supercell requests require an official key and stable, authorized outbound IP. Cloudflare Workers Free does not guarantee fixed egress.
- Backend access control, quotas, caching and controlled data retention are absent.
- Role taxonomy and tactical coaching require expert review; current UI explains provisional informational findings only.
- Full external card catalog and current balance/meta updates need an official API refresh process.
- Final legal and Fan Content Policy brand/advertising review is outstanding.
- Do not merge this branch into main without owner approval.

**Status**: website staging deployed; not a complete production MVP. Automated checks run in CI. Manual user acceptance testing should be scheduled only after MVP feature completion, per product owner.

## Battle Intelligence v0.3

Pure logic in `site/battle-insights.js`; 10 deterministic regression tests in `site/battle-insights.test.mjs`. All computations occur locally after the user chooses a JSON file. No player data sent to Cloudflare or written to Cloudflare storage. `deckSelection=eventDeck` is classified as event; other battle types are **unclassified**, not assumed Trophy Road. Available data is a partial snapshot, not a full lifetime win rate. Elixir leaked is reported, not a reconstructed tactical error.
