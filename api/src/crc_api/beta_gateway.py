"""Invite-only beta FastAPI entrypoint: NOT deployed or enabled by local app.

Design:
- Explicit opt-in for the separate factory; existing crc_api.main remains local-only.
- Signed Cloudflare Access JWT -> PostgreSQL quota -> Supercell in that order.
- Same-origin frontend and privately network-isolated backend required at deployment.
- Never trust forwarded identity headers, Host for authentication, or raw player tags.
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from dataclasses import dataclass
import os
import re
from urllib.parse import urlsplit, parse_qs
from uuid import uuid4
from typing import Any, Callable

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .domain import card_summary, normalize_battle, normalize_profile, normalize_tag
from .security.cloudflare_access import AccessDenied, AccessVerifier
from .security.private_beta import PrivateBetaAdmission
from .security.shared_quota import PostgresSharedQuota, QuotaDenied
from .supercell import SupercellClient, SupercellError
from .ai_coach import CoachRequest, CoachUnavailable, OpenRouterCoach
from .ai_daily_budget import SharedAIDailyBudget, AIDailyBudgetExceeded


HOST = re.compile(r"^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$")
SECRET_MARKER = "private-beta-explicit-owner-approval"


class UnsafeBetaConfiguration(RuntimeError):
    pass


@dataclass(frozen=True)
class BetaConfig:
    hostname: str
    team_domain: str
    audience: str
    allowed_subjects: frozenset[str]
    quota_hmac_secret: bytes
    database_dsn: str
    enabled: bool = True
    live_lookup_enabled: bool = False

    @classmethod
    def from_environment(cls) -> "BetaConfig":
        # This is a deployment switch, NOT an access credential. Fail closed.
        if os.environ.get("CRC_BETA_RUNTIME_GATE", "") != SECRET_MARKER:
            raise UnsafeBetaConfiguration("Private beta runtime has not been approved for activation.")
        host = os.environ.get("CRC_BETA_HOST", "").strip().lower()
        team = os.environ.get("CRC_BETA_TEAM_DOMAIN", "").strip().lower()
        audience = os.environ.get("CRC_BETA_AUDIENCE", "").strip()
        subjects = frozenset(s.strip() for s in
                             os.environ.get("CRC_BETA_ALLOWED_SUBJECTS", "").split(",") if s.strip())
        dsn = os.environ.get("CRC_BETA_POSTGRES_DSN", "")
        secret = os.environ.get("CRC_BETA_QUOTA_HMAC_HEX", "")
        try:
            secret_bytes = bytes.fromhex(secret)
        except ValueError as exc:
            raise UnsafeBetaConfiguration("Invalid beta quota key configuration.") from exc
        live = os.environ.get("CRC_BETA_LIVE_LOOKUP_ENABLED", "false") == "true"
        config = cls(host, team, audience, subjects, secret_bytes, dsn, live_lookup_enabled=live)
        config.validate()
        return config

    def validate(self) -> None:
        # Host is exact, not a wildcard. Test clients must supply an explicit
        # test-only hostname in their injected BetaConfig.
        if not self.enabled or not self.hostname or not HOST.fullmatch(self.hostname):
            raise UnsafeBetaConfiguration("Private beta hostname is not configured.")
        if (self.hostname.startswith(".") or ".." in self.hostname or
                self.hostname in ("localhost", "127.0.0.1", "0.0.0.0", "testserver")):
            raise UnsafeBetaConfiguration("Private beta hostname is not valid.")
        if not self.team_domain or not self.audience or not self.allowed_subjects:
            raise UnsafeBetaConfiguration("Cloudflare Access beta policy is incomplete.")
        if len(self.quota_hmac_secret) < 32:
            raise UnsafeBetaConfiguration("Private beta quota key is not configured.")
        try:
            parsed = urlsplit(self.database_dsn)
            if parsed.scheme not in ("postgres", "postgresql") or not parsed.hostname:
                raise ValueError("Invalid postgres DSN")
            if parsed.username is None or parsed.password is None:
                raise ValueError("Postgres credentials missing")
            # A private network does not automatically encrypt DB credentials.
            # The beta connection must verify both the certificate chain and
            # hostname. CI supplies a test-only pool factory instead.
            params = parse_qs(parsed.query, keep_blank_values=True)
            if params.get("sslmode") != ["verify-full"]:
                raise ValueError("Verified TLS is required for beta PostgreSQL")
        except (ValueError, TypeError) as exc:
            raise UnsafeBetaConfiguration("Private beta database is not configured.") from exc


def create_beta_app(
    *,
    config: BetaConfig | None = None,
    verifier: AccessVerifier | None = None,
    quota: PostgresSharedQuota | None = None,
    supercell: SupercellClient | None = None,
    pool_factory: Callable[[str], Any] | None = None,
    ai_client: OpenRouterCoach | None = None,
    ai_budget: SharedAIDailyBudget | None = None,
) -> FastAPI:
    """Separate --factory ASGI target, never imported by local crc_api.main.

    Dependency injections are for offline tests only. No server is provisioned,
    configured or made remotely reachable by constructing this app.
    """
    settings = config if config is not None else BetaConfig.from_environment()
    settings.validate()
    api = supercell if supercell is not None else SupercellClient()
    if settings.live_lookup_enabled and not api.configured:
        raise UnsafeBetaConfiguration("Private beta Supercell provider is not configured.")
    access = verifier or AccessVerifier(settings.team_domain, settings.audience, settings.allowed_subjects)
    budget = quota or PostgresSharedQuota(settings.quota_hmac_secret)
    # Even a configured API key cannot activate inference by itself.
    ai_switch = os.environ.get("CRC_BETA_AI_ENABLED", "false").strip().lower() == "true"
    chat = ai_client if ai_client is not None else OpenRouterCoach(
        api_key=os.environ.get("OPENROUTER_API_KEY", "")
    )
    daily_ai = ai_budget if ai_budget is not None else SharedAIDailyBudget(
        settings.quota_hmac_secret
    )
    ai_active = ai_switch and chat.configured

    if pool_factory is None:
        async def default_pool(dsn: str):
            import asyncpg  # Optional beta-only dependency.
            return await asyncpg.create_pool(
                dsn=dsn, min_size=1, max_size=5, timeout=5,
                command_timeout=5, server_settings={"application_name": "crc_private_beta"},
            )
        pool_factory = default_pool

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        try:
            pool = await pool_factory(settings.database_dsn)
        except Exception as exc:
            raise UnsafeBetaConfiguration("Private beta quota database unavailable.") from exc
        if pool is None:
            raise UnsafeBetaConfiguration("Private beta quota database unavailable.")
        app.state.pool = pool
        try:
            yield
        finally:
            await pool.close()

    app = FastAPI(
        title="Clash Royale Companion — private beta",
        docs_url=None, redoc_url=None, openapi_url=None,
        version="0.1.0-beta", lifespan=lifespan,
    )
    app.state.supercell = api
    app.state.admission = PrivateBetaAdmission(access, budget)
    app.state.ai_chat = chat
    app.state.ai_daily_budget = daily_ai
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=[settings.hostname])

    def error(status: int, code: str, rid: str, retry: int | None = None):
        response = JSONResponse(
            status_code=status,
            content={"request_id": rid, "error": {
                "code": code, "message": "درخواست قابل انجام نیست.", "retryable": status in (429, 503)}},
        )
        if retry is not None:
            response.headers["Retry-After"] = str(retry)
        return response

    @app.middleware("http")
    async def protected(request: Request, call_next):
        rid = "req_" + uuid4().hex[:16]
        request.state.request_id = rid
        # Do not expose any unauthenticated route, even capabilities. No CORS
        # middleware: browser app and protected gateway must share an origin.
        # Reject unsafe Host/Origin *before* spending JWT/JWKS or quota work.
        host = request.headers.get("host", "").lower()
        host_ok = host == settings.hostname or (
            host.startswith(settings.hostname + ":")
            and host[len(settings.hostname) + 1:].isdigit()
        )
        origin = request.headers.get("origin")
        origin_ok = origin is None or origin == "https://" + settings.hostname
        assertion = request.headers.get("Cf-Access-Jwt-Assertion", "")
        if not host_ok:
            response = error(400, "UNTRUSTED_HOST", rid)
        elif not origin_ok:
            response = error(403, "CROSS_ORIGIN_DENIED", rid)
        elif not assertion:
            response = error(401, "ACCESS_TOKEN_MISSING", rid)
        else:
            try:
                pool = request.app.state.pool
                async with pool.acquire() as connection:
                    admission = await request.app.state.admission.admit(assertion, connection)
                request.state.verified_subject = admission["subject"]
                response = await call_next(request)
            except AccessDenied as exc:
                status = 503 if exc.code == "ACCESS_KEYS_UNAVAILABLE" else 403
                response = error(status, exc.code, rid)
            except QuotaDenied as exc:
                response = error(429, exc.code, rid, exc.retry_after_seconds)
            except Exception:
                # Postgres unavailable, acquisition timeout or any unexpected
                # admission failure: no upstream calls, no exception leakage.
                response = error(503, "BETA_ADMISSION_UNAVAILABLE", rid)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Request-ID"] = rid
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Frame-Options"] = "DENY"
        return response

    @app.exception_handler(SupercellError)
    async def supercell_error(request: Request, exc: SupercellError):
        return JSONResponse(
            status_code=exc.http_status,
            content={"request_id": request.state.request_id,
                     "error": {"code": exc.code, "message": exc.public_message, "retryable": exc.retryable}},
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        return error(422, "INVALID_INPUT", request.state.request_id)

    @app.exception_handler(HTTPException)
    async def invalid_tag(request: Request, exc: HTTPException):
        return error(exc.status_code, str(exc.detail), request.state.request_id)

    def parse_tag(value: str) -> str:
        try:
            return normalize_tag(value)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="INVALID_PLAYER_TAG") from exc

    @app.get("/api/v1/capabilities")
    def capabilities():
        return {"schema_version": "1.0", "live_lookup_enabled": settings.live_lookup_enabled,
                "provider": "supercell", "player_tag_verifies_ownership": False,
                "battle_log_full_history": False, "safe_public_exposure": False,
                "ai_coach_enabled": ai_active, "ai_external_data_requires_consent": True}

    @app.get("/api/v1/health/ready")
    def protected_readiness(request: Request):
        """Authenticated diagnostic, not a public infrastructure liveness probe.

        Authentication and a PostgreSQL quota reservation have succeeded before
        this handler executes. Never request Supercell from a health probe.
        """
        return {
            "status": "ready_for_authenticated_requests",
            "checks": {
                "access_jwt": "verified",
                "shared_quota": "reserved",
            },
            "live_lookup_enabled": settings.live_lookup_enabled,
            "supercell_connectivity_checked": False,
            "full_production_readiness": False,
        }

    @app.get("/api/v1/catalog/cards")
    async def cards(request: Request):
        if not settings.live_lookup_enabled:
            return error(503, "BETA_LIVE_LOOKUP_DISABLED", request.state.request_id)
        data, provenance = await request.app.state.supercell.cards_record()
        return {"request_id": request.state.request_id,
                "catalog_version": "live-unversioned",
                "items": [card_summary(c) for c in data["items"] if isinstance(c, dict)],
                "source": provenance}

    @app.get("/api/v1/players/{tag}/snapshot")
    async def snapshot(tag: str, request: Request, limit: int = Query(default=25, ge=1, le=25)):
        if not settings.live_lookup_enabled:
            return error(503, "BETA_LIVE_LOOKUP_DISABLED", request.state.request_id)
        normalized = parse_tag(tag)
        raw, source = await request.app.state.supercell.player_record(normalized)
        profile = normalize_profile(raw)
        partial = False
        battle_code = None
        battle_source = None
        try:
            battle_raw, battle_source = await request.app.state.supercell.battles_record(normalized)
            battles = [normalize_battle(row) for row in battle_raw[:limit] if isinstance(row, dict)]
        except SupercellError as exc:
            partial, battle_code, battles = True, exc.code, []
        return {
            "request_id": request.state.request_id, **profile,
            "cards": [card_summary(c) for c in raw.get("cards", []) if isinstance(c, dict)],
            "support_items": [card_summary(c) for c in raw.get("supportCards", []) if isinstance(c, dict)],
            "battles": battles, "coverage": {"returned_count": len(battles), "full_history": False},
            "partial": partial, "battles_error_code": battle_code,
            "source": source, "battle_source": battle_source,
        }

    @app.post("/api/v1/coach/chat")
    async def protected_ai_chat(payload: CoachRequest, request: Request):
        """Never exposed on the public sample-only Worker.

        Signed Cloudflare Access, invited subject, shared minute quota, strict
        same-origin policy and private Host are all checked by middleware first.
        AI additionally requires the explicit owner switch, a server-only API
        key, explicit request consent, and a persistent UTC daily budget.
        The only accepted evidence is bounded, anonymous aggregate numbers.
        """
        rid = request.state.request_id
        if not ai_active:
            return error(503, "AI_COACH_DISABLED", rid)
        if not payload.consent_to_external_ai:
            return error(403, "AI_CONSENT_REQUIRED", rid)
        try:
            async with request.app.state.pool.acquire() as connection:
                await request.app.state.ai_daily_budget.reserve(
                    connection, request.state.verified_subject
                )
        except AIDailyBudgetExceeded as exc:
            return error(429, "AI_DAILY_BUDGET_EXCEEDED", rid, exc.retry_after_seconds)
        except Exception:
            # A missing/unmigrated quota table must never allow provider calls.
            return error(503, "AI_BUDGET_UNAVAILABLE", rid)
        try:
            result = await request.app.state.ai_chat.answer(payload)
        except CoachUnavailable as exc:
            status = 429 if exc.code == "AI_PROVIDER_RATE_LIMIT" else (
                403 if exc.code == "AI_CONSENT_REQUIRED" else 503
            )
            return error(status, exc.code, rid)
        return {
            "request_id": rid,
            **result,
            "external_inference": True,
            "input_provenance": "user-submitted unverified aggregates",
            "replay_analyzed": False,
        }

    return app
