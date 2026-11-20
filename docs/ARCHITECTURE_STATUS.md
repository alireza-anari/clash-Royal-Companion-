# Architecture decisions and open gates

- **Agreed proposal:** modular monolith; Next.js static frontend; FastAPI + PostgreSQL backend; Cloudflare Static Assets for frontend when needed.
- **Current deliverable:** a local FastAPI read-only adapter, not a deployed service. No persistent DB schema/migration has been run or committed.
- **Supercell key:** fixed-egress IPv4 required for authorized requests; do not expose API token to frontend.
- **Public hosting gate:** complete access controls, per-IP/device quotas, cache, retention/privacy review, stable backend egress and observability.
- **Game knowledge gate:** confirm card-role taxonomy and slot activation with 2 reviewers before tactical findings/replacements in production.
- **Data quality gate:** do not merge `eventDeck` with profile inventory. Unknown card costs remain unknown; no fabricated win rates or Replay placement claims.
- **Repository gate:** feature branches and mandatory PR review. Do not merge without owner approval.
