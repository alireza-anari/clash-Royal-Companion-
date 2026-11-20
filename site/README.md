# Clash Royale Companion — website staging v0.2

## Current staging

https://crc-mvp-stage-20261120.alirezaanari117.workers.dev/

This branch contains a mobile-first Persian frontend and a **separate Cloudflare Workers sample-only runtime**. It does not replace the modular FastAPI backend on the separate \`feat/backend-bootstrap\` branch.

## Functioning features

- Dashboard and persistent local card deck selection (eight slots)
- Card library with search, cost filters and card details
- Deterministic deck arithmetic and evidence-labelled, informational findings
- Profile import of official Supercell Player JSON via browser-only File API
- Battle Log import, event-deck distinction and summary rows
- Planned future Community and Tournament screens clearly not advertised as available
- No player data stored on server, no Supercell token in frontend and no live Supercell lookups
- Sample catalog populated from **public card metadata only**, extracted from an official API response provided for the project. No player tag, name, card ownership count, levels or account identifiers are in the seed.

## Development architecture

- \`site/index.html\`, \`styles.css\`, \`app.js\`, \`catalog.json\`: plain static files, no new dependency required for this temporary Worker-hosted UI.
- \`deploy/cloudflare/worker-runtime.js\`: stateless sample-only routes and assets.
- \`deploy/cloudflare/build-site.mjs\`: reproducible bundle to \`deploy/cloudflare/mvp-worker.js\`.
- \`node --test site/mvp.test.mjs\`: pure HTTP handler tests and source syntax checks.
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
