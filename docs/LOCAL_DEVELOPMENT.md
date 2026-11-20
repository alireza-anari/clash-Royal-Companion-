# Clash Royale Companion — backend bootstrap v0.1

**Status:** Local development scaffold only. Not ready for public hosting.

This release includes read-only Supercell endpoints, basic deck validation, exact arithmetic facts, and mock tests. No production authentication, persistent database, caching, rate limits, frontend, or deployed service. AI tactical coaching and replacement advice are intentionally not implemented.

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

Run tests from `api`: `python -m pytest`.

**Security:** never commit `.env`, paste a secret in chat, use a public Cloudflare Tunnel, or expose port 8000 without security controls. CORS is not authentication.

## Routes

- GET /api/v1/health/live and /api/v1/health/ready
- GET /api/v1/catalog/cards
- GET /api/v1/players/{tag}, /api/v1/players/{tag}/cards, /api/v1/players/{tag}/battles
- POST /api/v1/decks/validate
- POST /api/v1/analyses — arithmetic facts only

Use percent-encoded player tags in URLs, e.g. %23EXAMPLETAG. All upstream calls are server-side and read-only.
