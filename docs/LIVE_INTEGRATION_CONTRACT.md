# SP-LIVE-02 — Frontend ↔ FastAPI integration contract (implementation candidate)

**Status:** Contracts and UI transport implemented, but live connection **NOT deployed or enabled**.
Staging: https://crc-mvp-stage-20261120.alirezaanari117.workers.dev/
Branches: \`feat/mvp-frontend\` (UI) and \`feat/backend-bootstrap\` (FastAPI). Both Draft PRs; **do not merge** without owner approval.

## Data flow

\`\`\`text
Browser (CRC frontend, Player Tag only)
      │  GET /api/v1/capabilities     [no secrets, fail-closed]
      │  when live_lookup_enabled == true
      ├──GET /api/v1/players/%23TAG/snapshot?limit=25  [preferred]
      └──(fallback if old backend has no snapshot route)
         ├──GET /api/v1/players/%23TAG
         ├──GET /api/v1/players/%23TAG/cards
         └──GET /api/v1/players/%23TAG/battles?limit=25
                        │
             Protected FastAPI backend
             Official Supercell API
              (authorized egress IPv4)
\`\`\`

### Invariants

- Browser never receives an API key, even when live functionality is enabled.
- All routes use a fixed same-origin \`/api/v1\` path. No dynamic user-provided target URL or proxy address.
- The official API Player Tag is **public account lookup, not ownership verification**.
- Data from normalized backend responses is mapped into the already implemented browser-local Profile and Battle Intelligence views.
- \`eventDeck\` and unknown battle types stay separate. Do not claim that Battle Log contains replay action timestamps, win probability or complete player history.
- Local file import remains available when backend is unavailable.
- No private player JSON is stored by Cloudflare; optional local deck settings only persist in browser storage.
- Partial Battle Log failure preserves a successful profile but reports a partial result.
- Frontend will not make player calls when \`live_lookup_enabled\` is false or capabilities cannot be reached.

## Agreed response surface (current code, subject to OpenAPI alignment)

- \`GET /api/v1/capabilities\` returns \`{schema_version:"1.0",live_lookup_enabled:false,...}\`. Defaults **false** even if Supercell key exists.
- \`GET /api/v1/players/{tag}\` returns \`profile\`, \`current_deck\`, \`source.fetched_at\`.
- \`GET /api/v1/players/{tag}/cards\` returns \`items\`, \`support_items\` using \`id,name,elixir_cost,level_raw,icon_url\` keys.
- \`GET /api/v1/players/{tag}/battles\` returns \`items\` with participants, normalized RFC3339 \`battle_time\`, deck IDs and \`coverage.full_history=false\`.

Current frontend code: \`site/backend-client.js\`; tests: \`site/backend-client.test.mjs\`. Current backend code: \`api/src/crc_api/main.py\`; tests: \`api/tests/test_capabilities.py\`.

## Activation gates — ALL required

- [ ] Owner approves fixed outbound IPv4 backend and any costs.
- [ ] Backend is reachable with valid TLS and fixed Supercell-allowlisted egress IPv4.
- [ ] Authentication/abuse protections for public API are deployed and validated (IP/user quotas, cache, external budget).
- [ ] Same-origin forwarding of \`/api/v1/\` is configured to that backend, without open proxy or redirect of credentials.
- [ ] User data handling/retention, Supercell API terms and Fan Content Policy are reviewed.
- [ ] OpenAPI contract tests and live smoke tests succeed.
- [ ] \`CRC_LIVE_LOOKUP_ENABLED=true\` is explicitly approved in the **backend environment only**.
- [ ] Confirm effective \`/api/v1/capabilities\` is true *after* all protections; do not set this flag on Cloudflare sample-only staging.

## Known limitations of the present draft

- FastAPI local bootstrap does not have authentication, persistent caching, persistent rate limiting, production deployment or PostgreSQL.
- The frontend UI is vanilla JS/HTML proof of implementation, not the final Next.js build.
- No guarantee of stable outbound IP from Cloudflare Workers Free for direct Supercell API calls.
- Import of official JSON is still an acceptable local-only fallback but not equivalent to live synchronization.
- Supercell card-role expertise, hero/evolution activation flags, and current balance/meta data remain subject to review.
- A green CI run on mocked data is **not** validation of production connectivity or of correctness of game strategy.

**Next engineering milestone:** secure backend persistence + request-budget/rate-limit controls, then deployment on owner-approved fixed-egress infrastructure. Keep test data mocked until IP and key are explicitly available.
