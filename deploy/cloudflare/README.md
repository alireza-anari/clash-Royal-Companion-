# Cloudflare Workers Free — CRC Deck Lab preview

This is a **separate, sample-data-only** test UI. It is not the FastAPI backend, a production application, or a live Supercell proxy.

URL: https://crc-deck-lab-preview-20261120.alirezaanari117.workers.dev/

## What is operational?

- Mobile-first Persian (RTL) interface.
- Two reusable eight-card sample decks.
- Change any card and run a deterministic, server-side calculation.
- Endpoints: GET \`/\`, GET \`/health\`, GET \`/api/cards\`, POST \`/api/analyze\`.
- Validates exactly eight known, unique card IDs and reports average elixir, cheapest-four cost, and count of high/low cost cards.
- No database, cookies, persistent storage, tracking, public Supercell tag lookup, user account credentials, or external API calls.

## What is NOT operational?

- Live Supercell player profile / Battle Log retrieval from Cloudflare.
- Python FastAPI service, PostgreSQL, user authentication, private player inventory and tactical AI coaching.
- GitHub-to-Cloudflare continuous deployment; the deployed Worker was uploaded through the Cloudflare API as an isolated test artifact.

## Why no Supercell live connection?

Supercell API key permissions are tied to authorized outbound IPs. Cloudflare Free Workers do not guarantee a fixed outgoing IPv4 for these requests. We do not weaken authorization or expose the token in a browser to work around this.

## Security and operations

- Worker's source includes no API key or private user data.
- The URL is publicly accessible even though the GitHub branch is private; share only for UI/interaction testing.
- Sample values are not current balance/meta or a live player's actual deck.
- Before any public player API: fixed egress, authentication, rate limiting, cache, quotas, privacy and consent policies, verified contract and production monitoring.
- Do not merge this preview branch to \`main\` without owner approval.

## Testing

From Node.js 22+: \`node --test deploy/cloudflare/test-worker.mjs\`.

Deployment is currently manual via authorized Cloudflare account; CI verifies syntax and deterministic sample behavior only.
