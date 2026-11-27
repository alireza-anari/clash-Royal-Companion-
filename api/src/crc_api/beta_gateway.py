"""Invite-only beta FastAPI entrypoint: NOT deployed or enabled by local app.

Design:
- Explicit opt-in for the separate factory; existing crc_api.main remains local-only.
- Short-lived signed Worker assertion -> PostgreSQL quota -> Supercell in that order.
- The edge mints assertions after validating one-time invite codes and its HttpOnly session.
- Same-origin frontend and privately network-isolated backend required at deployment.
- Never trust browser-supplied identity, forwarded headers, Host for authentication, or raw player tags.
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from dataclasses import dataclass
import os
import re
from urllib.parse import urlsplit, parse_qs
from uuid import UUID, uuid4
from typing import Any, Callable

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .domain import card_summary, normalize_battle, normalize_profile, normalize_tag
from .security.worker_assertion import WorkerAssertionDenied, WorkerAssertionVerifier
from .security.private_beta import PrivateBetaAdmission
from .security.shared_quota import PostgresSharedQuota, QuotaDenied
from .supercell import SupercellClient, SupercellError
from .ai_coach import CoachRequest, CoachUnavailable, OpenRouterCoach
from .ai_daily_budget import SharedAIDailyBudget, AIDailyBudgetExceeded
from .ssm_secret import load_openrouter_key_from_ssm, SSMSecretUnavailable
from .beta_db_tls import verified_beta_ssl_context
from .beta_db_secret import credential_dsn, BetaDatabaseCredentialUnavailable
from .identity import (OIDCIdentityService, OIDCExchangeRequest, OIDCInvalidToken, OIDCNonceReplay, OIDCProviderUnavailable)
from .ssm_secret import load_account_identity_key_from_ssm, ACCOUNT_ID_PARAMETER_NAME, AccountIdentityKeyUnavailable
from .vision_jobs import (PostgresVisionJobs, VisionJobRequest, VisionCreditsExhausted,
                           VisionIdempotencyConflict, VisionInputError, VisionJobStateConflict, VisionJobNotFound,
                           VisionWorkerResult, VisionWorkerCompleteRequest, VisionWorkerFailRequest, VISION_WORKER_SUBJECT,
                           ACCOUNT_SUBJECT, MAX_FRAMES, MAX_FRAME_BYTES, MAX_TOTAL_BYTES,
                           MAX_SIDE, MAX_CAPTURE_MS)


HOST = re.compile(r"^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$")
SECRET_MARKER = "private-beta-explicit-owner-approval"


class UnsafeBetaConfiguration(RuntimeError):
    pass


@dataclass(frozen=True)
class BetaConfig:
    hostname: str
    auth_issuer: str
    audience: str
    allowed_subjects: frozenset[str]
    quota_hmac_secret: bytes
    worker_assertion_secret: bytes
    database_dsn: str
    enabled: bool = True
    live_lookup_enabled: bool = False
    vision_requested: bool = False
    vision_processor_ready: bool = False
    vision_worker_requested: bool = False
    vision_subjects: frozenset[str] = frozenset()
    vision_hmac_secret: bytes = b""
    oidc_issuer: str = ""
    oidc_client_id: str = ""
    oidc_jwks_url: str = ""
    oidc_redirect_uri: str = ""
    account_hmac_secret: bytes = b""

    @property
    def vision_enabled(self) -> bool:
        return (self.vision_requested and self.vision_processor_ready and bool(self.vision_subjects)
                and self.vision_subjects.issubset(self.allowed_subjects)
                and len(self.vision_hmac_secret) >= 32)

    @property
    def oidc_enabled(self) -> bool:
        return (bool(self.oidc_issuer and self.oidc_client_id and self.oidc_jwks_url and self.oidc_redirect_uri)
                and len(self.account_hmac_secret) >= 32)

    @property
    def vision_worker_enabled(self) -> bool:
        return self.vision_enabled and self.vision_worker_requested

    @classmethod
    def from_environment(cls) -> "BetaConfig":
        # This is a deployment switch, NOT an access credential. Fail closed.
        if os.environ.get("CRC_BETA_RUNTIME_GATE", "") != SECRET_MARKER:
            raise UnsafeBetaConfiguration("Private beta runtime has not been approved for activation.")
        host = os.environ.get("CRC_BETA_HOST", "").strip().lower()
        issuer = os.environ.get("CRC_BETA_AUTH_ISSUER", "").strip().lower()
        audience = os.environ.get("CRC_BETA_AUTH_AUDIENCE", "").strip()
        subjects = frozenset(s.strip() for s in
                             os.environ.get("CRC_BETA_ALLOWED_SUBJECTS", "").split(",") if s.strip())
        # The database password must never be placed in an environment
        # variable (visible via Docker inspect). The Docker runtime reads
        # a single UID-10001-only, read-only secret file mounted from host
        # /run tmpfs. No plaintext DSN may be supplied as a fallback.
        if os.environ.get("CRC_BETA_POSTGRES_DSN") is not None:
            raise UnsafeBetaConfiguration("Plaintext database environment credentials are forbidden.")
        try:
            dsn = credential_dsn(os.environ.get("CRC_BETA_POSTGRES_DB", ""))
        except BetaDatabaseCredentialUnavailable:
            raise UnsafeBetaConfiguration("Private beta database credential is unavailable.") from None
        secret = os.environ.get("CRC_BETA_QUOTA_HMAC_HEX", "")
        assertion_secret = os.environ.get("CRC_BETA_WORKER_ASSERTION_HMAC_HEX", "")
        try:
            secret_bytes = bytes.fromhex(secret)
            assertion_bytes = bytes.fromhex(assertion_secret)
        except ValueError as exc:
            raise UnsafeBetaConfiguration("Invalid beta signing key configuration.") from exc
        live = os.environ.get("CRC_BETA_LIVE_LOOKUP_ENABLED", "false") == "true"
        vision_requested = os.environ.get("CRC_BETA_VISION_ENABLED", "false") == "true"
        vision_processor_ready = os.environ.get("CRC_BETA_VISION_PROCESSOR_READY", "false") == "true"
        vision_worker_requested = os.environ.get("CRC_BETA_VISION_WORKER_ENABLED", "false") == "true"
        vision_subjects = frozenset(s.strip() for s in
            os.environ.get("CRC_BETA_VISION_ALLOWED_SUBJECTS", "").split(",") if s.strip())
        try:
            vision_secret = bytes.fromhex(os.environ.get("CRC_BETA_VISION_HMAC_HEX", ""))
        except ValueError:
            raise UnsafeBetaConfiguration("Invalid vision signing key configuration.") from None
        oidc_issuer = os.environ.get("CRC_BETA_OIDC_ISSUER", "").strip()
        oidc_client_id = os.environ.get("CRC_BETA_OIDC_CLIENT_ID", "").strip()
        oidc_jwks_url = os.environ.get("CRC_BETA_OIDC_JWKS_URL", "").strip()
        oidc_redirect_uri = os.environ.get("CRC_BETA_OIDC_REDIRECT_URI", "").strip()
        account_secret_hex = os.environ.get("CRC_BETA_ACCOUNT_ID_HMAC_HEX", "").strip()
        if any((oidc_issuer, oidc_client_id, oidc_jwks_url, oidc_redirect_uri)) and not account_secret_hex:
            try:
                account_secret_hex = load_account_identity_key_from_ssm(
                    enabled=True, parameter=ACCOUNT_ID_PARAMETER_NAME
                )
            except AccountIdentityKeyUnavailable:
                raise UnsafeBetaConfiguration("Stable account identity key is unavailable.") from None
        try:
            account_secret = bytes.fromhex(account_secret_hex)
        except ValueError:
            raise UnsafeBetaConfiguration("Invalid account identity key configuration.") from None
        config = cls(host, issuer, audience, subjects, secret_bytes, assertion_bytes, dsn,
                     live_lookup_enabled=live, vision_requested=vision_requested,
                     vision_processor_ready=vision_processor_ready, vision_worker_requested=vision_worker_requested,
                     vision_subjects=vision_subjects,
                     vision_hmac_secret=vision_secret, oidc_issuer=oidc_issuer,
                     oidc_client_id=oidc_client_id, oidc_jwks_url=oidc_jwks_url,
                     oidc_redirect_uri=oidc_redirect_uri, account_hmac_secret=account_secret)
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
        issuer = urlsplit(self.auth_issuer)
        if (issuer.scheme != "https" or issuer.hostname != self.hostname or
                issuer.username is not None or issuer.password is not None or
                issuer.path not in ("", "/") or issuer.query or issuer.fragment):
            raise UnsafeBetaConfiguration("Worker assertion issuer must match the exact HTTPS beta host.")
        if not self.audience or not self.allowed_subjects:
            raise UnsafeBetaConfiguration("Private beta invite policy is incomplete.")
        if len(self.quota_hmac_secret) < 32:
            raise UnsafeBetaConfiguration("Private beta quota key is not configured.")
        if len(self.worker_assertion_secret) < 32:
            raise UnsafeBetaConfiguration("Worker assertion signing key is not configured.")
        if self.vision_subjects and (not self.vision_subjects.issubset(self.allowed_subjects) or
                                     any(not ACCOUNT_SUBJECT.fullmatch(s) for s in self.vision_subjects)):
            raise UnsafeBetaConfiguration("Vision subjects must be explicit stable account identities in the invite allowlist.")
        if self.vision_worker_requested and not self.vision_enabled:
            raise UnsafeBetaConfiguration("Vision worker cannot be enabled before the vision processor and account gates are ready.")
        oidc_values = (self.oidc_issuer, self.oidc_client_id, self.oidc_jwks_url, self.oidc_redirect_uri)
        if any(oidc_values) and not all(oidc_values):
            raise UnsafeBetaConfiguration("OIDC issuer, client ID, JWKS URL and redirect URI must be configured together.")
        if all(oidc_values):
            issuer_url, jwks_url, redirect_url = map(urlsplit, (self.oidc_issuer, self.oidc_jwks_url, self.oidc_redirect_uri))
            if (issuer_url.scheme != "https" or not issuer_url.hostname or issuer_url.username is not None or issuer_url.password is not None
                    or issuer_url.query or issuer_url.fragment or not self.oidc_client_id or len(self.oidc_client_id) > 512
                    or jwks_url.scheme != "https" or not jwks_url.hostname or jwks_url.username is not None or jwks_url.password is not None
                    or jwks_url.fragment or len(self.account_hmac_secret) < 32):
                raise UnsafeBetaConfiguration("OIDC provider or stable account identity key is invalid.")
            if redirect_url.scheme == "https":
                redirect_ok = bool(redirect_url.hostname and redirect_url.username is None and redirect_url.password is None and not redirect_url.fragment)
            else:
                redirect_ok = bool(re.fullmatch(r"[a-z][a-z0-9+.-]{1,63}", redirect_url.scheme)
                                    and not redirect_url.netloc and redirect_url.path.startswith("/") and not redirect_url.fragment)
            if not redirect_ok:
                raise UnsafeBetaConfiguration("OIDC native redirect URI is invalid.")
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
    verifier: WorkerAssertionVerifier | None = None,
    quota: PostgresSharedQuota | None = None,
    supercell: SupercellClient | None = None,
    pool_factory: Callable[[str], Any] | None = None,
    ai_client: OpenRouterCoach | None = None,
    ai_budget: SharedAIDailyBudget | None = None,
    vision_jobs: PostgresVisionJobs | None = None,
    oidc_service: OIDCIdentityService | None = None,
) -> FastAPI:
    """Separate --factory ASGI target, never imported by local crc_api.main.

    Dependency injections are for offline tests only. No server is provisioned,
    configured or made remotely reachable by constructing this app.
    """
    settings = config if config is not None else BetaConfig.from_environment()
    settings.validate()
    # Real --factory startup has no injected test configuration. Verify that
    # the operator-mounted CA matches the reviewed root BEFORE opening a port,
    # loading AI secrets, or contacting the database.
    if config is None:
        verified_beta_ssl_context(settings.database_dsn)
    api = supercell if supercell is not None else SupercellClient()
    if settings.live_lookup_enabled and not api.configured:
        raise UnsafeBetaConfiguration("Private beta Supercell provider is not configured.")
    identity_subjects = settings.allowed_subjects | ({VISION_WORKER_SUBJECT} if settings.vision_worker_requested else set())
    identity = verifier or WorkerAssertionVerifier(settings.auth_issuer, settings.audience, frozenset(identity_subjects), settings.worker_assertion_secret, allow_account_subjects=settings.oidc_enabled)
    budget = quota or PostgresSharedQuota(settings.quota_hmac_secret)
    # Even a configured API key cannot activate inference by itself.
    ai_switch = os.environ.get("CRC_BETA_AI_ENABLED", "false").strip().lower() == "true"
    # Never read Parameter Store at import time or when AI is disabled.
    # Reject plaintext OPENROUTER_API_KEY environment secrets for this beta.
    if ai_client is not None:  # Test-only dependency injection.
        chat = ai_client
    elif ai_switch:
        try:
            key = load_openrouter_key_from_ssm(
                enabled=True,
                parameter=os.environ.get("CRC_OPENROUTER_SSM_PARAMETER", ""),
            )
        except SSMSecretUnavailable:
            # Do not chain AWS stderr, key contents, or response bodies.
            raise UnsafeBetaConfiguration("AI credential could not be loaded.") from None
        chat = OpenRouterCoach(api_key=key)
        if not chat.configured:
            raise UnsafeBetaConfiguration("AI credential could not be loaded.")
    else:
        chat = OpenRouterCoach(api_key="")
    daily_ai = ai_budget if ai_budget is not None else SharedAIDailyBudget(
        settings.quota_hmac_secret
    )
    ai_active = ai_switch and chat.configured
    vision_service = vision_jobs or (PostgresVisionJobs(settings.vision_hmac_secret) if settings.vision_enabled else None)
    oidc_identity = oidc_service or (OIDCIdentityService(
        issuer=settings.oidc_issuer, client_id=settings.oidc_client_id, jwks_url=settings.oidc_jwks_url,
        redirect_uri=settings.oidc_redirect_uri, beta_issuer=settings.auth_issuer,
        worker_secret=settings.worker_assertion_secret, account_secret=settings.account_hmac_secret,
    ) if settings.oidc_enabled else None)

    if pool_factory is None:
        async def default_pool(dsn: str):
            import asyncpg  # Optional beta-only dependency.
            # Never rely on ambient system roots or asyncpg SSL defaults.
            # Explicit context checks BOTH the server chain and DNS hostname.
            tls = verified_beta_ssl_context(dsn)
            return await asyncpg.create_pool(
                dsn=dsn, ssl=tls, min_size=1, max_size=5, timeout=5,
                command_timeout=5, server_settings={"application_name": "crc_private_beta"},
            )
        pool_factory = default_pool

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        try:
            pool = await pool_factory(settings.database_dsn)
        except Exception:
            # Do not chain asyncpg exceptions, which might include a DSN or
            # credential in their repr or server-side diagnostic strings.
            raise UnsafeBetaConfiguration("Private beta quota database unavailable.") from None
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
    app.state.admission = PrivateBetaAdmission(identity, budget)
    app.state.ai_chat = chat
    app.state.ai_daily_budget = daily_ai
    app.state.vision_jobs = vision_service
    app.state.oidc_identity = oidc_identity
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
        assertion = request.headers.get("X-CRC-Worker-Assertion", "")
        if not host_ok:
            response = error(400, "UNTRUSTED_HOST", rid)
        elif not origin_ok:
            response = error(403, "CROSS_ORIGIN_DENIED", rid)
        elif not assertion:
            response = error(401, "WORKER_ASSERTION_MISSING", rid)
        else:
            try:
                worker_routes = {
                    "/api/v1/vision/worker/claim",
                    "/api/v1/vision/worker/complete",
                    "/api/v1/vision/worker/fail",
                }
                is_worker_route = request.url.path in worker_routes
                if is_worker_route:
                    if request.method != "POST" or not settings.vision_worker_requested:
                        response = error(403, "VISION_WORKER_NOT_AUTHORIZED", rid)
                    else:
                        subject = await identity.verify(assertion)
                        if subject != VISION_WORKER_SUBJECT:
                            response = error(403, "VISION_WORKER_NOT_AUTHORIZED", rid)
                        else:
                            request.state.verified_subject = subject
                            response = await call_next(request)
                else:
                    pool = request.app.state.pool
                    async with pool.acquire() as connection:
                        admission = await request.app.state.admission.admit(assertion, connection)
                    if admission["subject"] == VISION_WORKER_SUBJECT:
                        response = error(403, "VISION_WORKER_ROUTE_REQUIRED", rid)
                    else:
                        request.state.verified_subject = admission["subject"]
                        response = await call_next(request)
            except WorkerAssertionDenied as exc:
                response = error(403, exc.code, rid)
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

    @app.get("/api/v1/auth/oidc/config")
    def oidc_public_config(request: Request):
        service=request.app.state.oidc_identity
        if service is None:
            return error(503,"OIDC_SIGN_IN_DISABLED",request.state.request_id)
        return service.public_config()

    @app.post("/api/v1/auth/oidc/nonce")
    def oidc_nonce(request: Request):
        service=request.app.state.oidc_identity
        if service is None:
            return error(503,"OIDC_SIGN_IN_DISABLED",request.state.request_id)
        try:
            return service.create_nonce()
        except OIDCProviderUnavailable:
            return error(503,"OIDC_SIGN_IN_DISABLED",request.state.request_id)

    @app.post("/api/v1/auth/oidc/exchange")
    async def oidc_exchange(payload: OIDCExchangeRequest,request: Request):
        rid=request.state.request_id
        service=request.app.state.oidc_identity
        if service is None:
            return error(503,"OIDC_SIGN_IN_DISABLED",rid)
        try:
            async with request.app.state.pool.acquire() as connection:
                return await service.exchange(connection,payload.id_token,payload.nonce_token)
        except OIDCNonceReplay:
            return error(409,"OIDC_NONCE_REPLAYED",rid)
        except OIDCInvalidToken:
            return error(401,"OIDC_TOKEN_INVALID",rid)
        except OIDCProviderUnavailable:
            return error(503,"OIDC_PROVIDER_UNAVAILABLE",rid)
        except Exception:
            return error(503,"OIDC_IDENTITY_UNAVAILABLE",rid)

    @app.get("/api/v1/capabilities")
    def capabilities():
        return {"schema_version": "1.0", "live_lookup_enabled": settings.live_lookup_enabled,
                "provider": "supercell", "player_tag_verifies_ownership": False,
                "battle_log_full_history": False, "safe_public_exposure": False,
                "ai_coach_enabled": ai_active, "ai_external_data_requires_consent": True,
                "vision_analysis_enabled": settings.vision_enabled,
                "vision_upload_requires_consent": True,
                "vision_max_frames": MAX_FRAMES,
                "vision_max_frame_bytes": MAX_FRAME_BYTES,
                "vision_max_total_bytes": MAX_TOTAL_BYTES}

    @app.get("/api/v1/health/ready")
    def protected_readiness(request: Request):
        """Authenticated diagnostic, not a public infrastructure liveness probe.

        Authentication and a PostgreSQL quota reservation have succeeded before
        this handler executes. Never request Supercell from a health probe.
        """
        return {
            "status": "ready_for_authenticated_requests",
            "checks": {
                "worker_assertion": "verified",
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

    def vision_worker_authorized(request: Request) -> bool:
        return (settings.vision_worker_enabled and
                getattr(request.state, "verified_subject", None) == VISION_WORKER_SUBJECT and
                request.app.state.vision_jobs is not None)

    @app.post("/api/v1/vision/worker/claim")
    async def claim_vision_job(request: Request):
        rid=request.state.request_id
        if not vision_worker_authorized(request):
            return error(503,"VISION_WORKER_DISABLED",rid)
        try:
            async with request.app.state.pool.acquire() as connection:
                await request.app.state.vision_jobs.recover_stale(connection,limit=20)
                await request.app.state.vision_jobs.expire_due(connection,limit=50)
                job=await request.app.state.vision_jobs.claim_next(connection,lease_seconds=900)
        except Exception:
            return error(503,"VISION_QUEUE_UNAVAILABLE",rid)
        return {"request_id":rid,"job":job}

    @app.post("/api/v1/vision/worker/complete")
    async def complete_vision_job(payload: VisionWorkerCompleteRequest,request: Request):
        rid=request.state.request_id
        if not vision_worker_authorized(request):
            return error(503,"VISION_WORKER_DISABLED",rid)
        try:
            async with request.app.state.pool.acquire() as connection:
                result=await request.app.state.vision_jobs.complete(
                    connection,payload.job_id,payload.lease_token,payload.result)
        except VisionJobNotFound:
            return error(404,"VISION_JOB_NOT_FOUND",rid)
        except VisionJobStateConflict:
            return error(409,"VISION_JOB_LEASE_INVALID",rid)
        except VisionInputError:
            return error(422,"VISION_RESULT_INVALID",rid)
        except Exception:
            return error(503,"VISION_QUEUE_UNAVAILABLE",rid)
        return {"request_id":rid,**result}

    @app.post("/api/v1/vision/worker/fail")
    async def fail_vision_job(payload: VisionWorkerFailRequest,request: Request):
        rid=request.state.request_id
        if not vision_worker_authorized(request):
            return error(503,"VISION_WORKER_DISABLED",rid)
        try:
            async with request.app.state.pool.acquire() as connection:
                result=await request.app.state.vision_jobs.fail(
                    connection,payload.job_id,payload.lease_token,payload.error_code)
        except VisionJobNotFound:
            return error(404,"VISION_JOB_NOT_FOUND",rid)
        except VisionJobStateConflict:
            return error(409,"VISION_JOB_LEASE_INVALID",rid)
        except Exception:
            return error(503,"VISION_QUEUE_UNAVAILABLE",rid)
        return {"request_id":rid,**result}

    @app.get("/api/v1/vision/capabilities")
    def vision_capabilities(request: Request):
        account_enabled = settings.vision_enabled and request.state.verified_subject in settings.vision_subjects
        reason = None if account_enabled else (
            "VISION_ACCOUNT_NOT_ELIGIBLE" if settings.vision_enabled else "VISION_NOT_CONFIGURED"
        )
        return {
            "schema_version": "1.0", "enabled": account_enabled, "reason": reason,
            "upload_enabled": account_enabled, "analysis_enabled": account_enabled,
            "credits_enabled": account_enabled, "account_identity_required": True,
            "upload_consent_required": True, "external_ai_consent_required": True,
            "max_frames": MAX_FRAMES, "max_frame_bytes": MAX_FRAME_BYTES,
            "max_total_bytes": MAX_TOTAL_BYTES, "max_side": MAX_SIDE,
            "max_capture_ms": MAX_CAPTURE_MS, "image_format": "image/jpeg",
            "storage": "private-postgresql-bytea" if account_enabled else None,
            "processing": "queued" if account_enabled else "disabled",
        }

    def vision_account(request: Request) -> str | None:
        subject = getattr(request.state, "verified_subject", None)
        if not settings.vision_enabled or subject not in settings.vision_subjects:
            return None
        return subject

    @app.post("/api/v1/vision/jobs", status_code=202)
    async def create_vision_job(payload: VisionJobRequest, request: Request):
        rid = request.state.request_id
        subject = vision_account(request)
        if subject is None or request.app.state.vision_jobs is None:
            return error(503, "VISION_ANALYSIS_DISABLED", rid)
        if payload.consent_to_upload is not True or payload.consent_to_external_ai is not True:
            return error(403, "VISION_CONSENT_REQUIRED", rid)
        try:
            async with request.app.state.pool.acquire() as connection:
                result = await request.app.state.vision_jobs.submit(connection, subject, payload)
        except VisionCreditsExhausted:
            return error(402, "VISION_CREDITS_EXHAUSTED", rid)
        except VisionIdempotencyConflict:
            return error(409, "VISION_IDEMPOTENCY_CONFLICT", rid)
        except VisionInputError:
            return error(422, "VISION_IMAGE_INVALID", rid)
        except Exception:
            return error(503, "VISION_QUEUE_UNAVAILABLE", rid)
        return {"request_id": rid, **result}

    @app.get("/api/v1/vision/jobs/{job_id}")
    async def get_vision_job(job_id: UUID, request: Request):
        rid = request.state.request_id
        subject = vision_account(request)
        if subject is None or request.app.state.vision_jobs is None:
            return error(503, "VISION_ANALYSIS_DISABLED", rid)
        try:
            async with request.app.state.pool.acquire() as connection:
                result = await request.app.state.vision_jobs.get(connection, subject, job_id)
        except Exception:
            return error(503, "VISION_QUEUE_UNAVAILABLE", rid)
        if result is None:
            return error(404, "VISION_JOB_NOT_FOUND", rid)
        return {"request_id": rid, **result}

    @app.delete("/api/v1/vision/jobs/{job_id}")
    async def cancel_vision_job(job_id: UUID, request: Request):
        rid = request.state.request_id
        subject = vision_account(request)
        if subject is None or request.app.state.vision_jobs is None:
            return error(503, "VISION_ANALYSIS_DISABLED", rid)
        try:
            async with request.app.state.pool.acquire() as connection:
                result = await request.app.state.vision_jobs.cancel(connection, subject, job_id)
        except VisionJobStateConflict:
            return error(409, "VISION_JOB_NOT_CANCELLABLE", rid)
        except Exception:
            return error(503, "VISION_QUEUE_UNAVAILABLE", rid)
        if result is None:
            return error(404, "VISION_JOB_NOT_FOUND", rid)
        return {"request_id": rid, **result}

    @app.post("/api/v1/coach/chat")
    async def protected_ai_chat(payload: CoachRequest, request: Request):
        """Never exposed on the public sample-only Worker.

        Signed Worker assertion, invited subject, shared minute quota, strict
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
