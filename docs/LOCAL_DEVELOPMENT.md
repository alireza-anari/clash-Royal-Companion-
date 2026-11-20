# Clash Royale Companion — backend bootstrap v0.1

**Status:** Local development scaffold only. Not ready for public hosting.

This release includes read-only Supercell endpoints, deck arithmetic, bounded in-memory TTL caching and per-process request budgeting. The HTTP API refuses non-loopback socket peers and applies a local per-peer rate limit. These measures are for **Windows local development only**: no production authentication, distributed quotas, persistent database, public hosting, frontend deployment or scalable cache. Tactical coaching and replacement advice are intentionally not implemented.

## Windows (PowerShell)

Requires Python 3.11+ and a Supercell key whose authorized IPv4 matches the computer's public egress IP.

1. Clone the repository and open it in a terminal.
2. Run `cd api`.
3. Run `py -3 -m venv .venv`.
4. Run `.\.venv\Scripts\Activate.ps1` (or invoke `.\.venv\Scripts\python.exe` directly).
5. Run `python -m pip install -e ".[test]"`.
6. Run `Copy-Item ..\.env.example .env`, edit `api/.env` privately and set `SUPERCELL_API_KEY`.
7. Run `python -m uvicorn crc_api.main:app --reload --host 127.0.0.1 --port 8000`.
8. Open `http://127.0.0.1:8000/docs`.

Run tests from `api`: `python -m pytest`. Only mock Supercell responses are used by automated tests.

**Security:** never commit `.env`, paste a secret in chat, use a public Cloudflare Tunnel, or expose port 8000 without security controls. CORS is not authentication. The local-only gate uses the immediate socket peer, ignoring `X-Forwarded-For` or Host headers; do not put this API behind any external proxy or run with externally listening interfaces. If `CRC_INTERNAL_ACCESS_TOKEN` is set, local requests require `X-CRC-Internal-Token`; never put that secret in frontend JavaScript. One worker/process only for local testing.

## Routes

- GET /api/v1/health/live and /api/v1/health/ready, /api/v1/capabilities
- GET /api/v1/catalog/cards
- GET /api/v1/players/{tag}, /api/v1/players/{tag}/cards, /api/v1/players/{tag}/battles, /api/v1/players/{tag}/snapshot
- POST /api/v1/decks/validate
- POST /api/v1/analyses — arithmetic facts only

Use percent-encoded player tags in URLs, e.g. %23EXAMPLETAG. All upstream calls are server-side and read-only.

## Local request protection and caching (SP-LIVE-04)

- Non-loopback socket peers are blocked (HTTP 403 `LOCAL_ONLY`). This is a conservative local development gate, not a production reverse-proxy design.
- `CRC_LOCAL_RPM=60`: per-peer local HTTP admission in a sliding 60-second window (HTTP 429 with `Retry-After` after limit).
- `CRC_INTERNAL_ACCESS_TOKEN`: optional extra internal-only token for local requests; NEVER embed it in a browser or PWA. Keep empty for simple desktop-only testing.
- `CRC_UPSTREAM_RPM=90`: per-process conservative 60-second **outbound attempt** ceiling. This value is a local safety default and **is NOT a claim about an official Supercell quota**. 429 `LOCAL_UPSTREAM_BUDGET` is returned when exceeded.
- Valid official responses only are cached in process RAM: catalog 900 s, profile 30 s, Battle Log 15 s by default. Invalid responses and upstream errors are not cached. Simultaneous identical calls share one upstream attempt.
- Cache is bounded by `CRC_CACHE_MAX_ENTRIES=256`; no disk persistence, no Redis, and no shared cross-process cache. The API returns `source.fetched_at` as the actual upstream fetch time and `source.cached` to distinguish cache hits.
- A restart clears cached public player data. Each process has independent counters and cache; **do not use this limiter as public/production abuse protection**.
- Latest available Battle Log is only a snapshot, not a complete history. No placement, replay events, or genuine match win rate is inferred.

**Remaining launch blockers:** authorized fixed outbound IPv4, authenticated public admission, distributed rate limits/quotas, cache privacy/retention policy, upstream retry and quota strategy, stable database and production observability. No Cloudflare live proxy is activated by these changes.


## Fail-closed runtime and Docker packaging (SP-DEPLOY-01)

- \`CRC_RUNTIME_MODE=local\` is the only supported setting. Configuring \`remote\`, \`staging\` or \`production\` causes startup failure rather than silently opening an insecure service.
- Local CORS settings accept exact localhost/loopback HTTP(S) origins with explicit ports only. External origins and wildcard origins are rejected at startup.
- The API checks the request's Host header and immediate socket peer; this does not make it production-ready.
- CI builds a non-root Docker image from \`deploy/docker/Dockerfile.local\` and smoke-tests it **inside the container** with external networking disabled.
- Do **not** publish Docker ports or use a public Tunnel: the local-only request gate intentionally rejects Docker bridge peers and has no vetted reverse-proxy trust configuration yet.
- On Windows, Python/Uvicorn bound to \`127.0.0.1\` (instructions above) remains the supported local method for real Supercell testing when the personal outbound IP is allowlisted.
- See \`docs/DEPLOYMENT_READINESS.md\` for fixed-egress options and explicit production launch gates.

The Docker job validates packaging/security guards only. It neither establishes real API availability nor provides an always-on hosted server.
