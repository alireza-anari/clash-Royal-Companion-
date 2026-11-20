"""Local-only API milestone: read-only Supercell adapter and deck arithmetic.

Not production-ready: no public traffic admission or persistent rate limiting.
"""
from __future__ import annotations

import os
from uuid import uuid4

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .domain import (card_summary, deck_metrics, normalize_battle, normalize_profile,
                     normalize_tag, validate_deck_ids)
from .supercell import SupercellClient, SupercellError
from .traffic import AdmissionError, configured_admission

load_dotenv()


class DeckInput(BaseModel):
    card_ids: list[int] = Field(default_factory=list, max_length=32)
    mode: str = "standard"
    source: str = "manual"
    support_card_ids: list[int] = Field(default_factory=list, max_length=8)


class AnalysisInput(BaseModel):
    deck: DeckInput
    locale: str = "fa-IR"
    player_tag: str | None = None


def create_app(supercell: SupercellClient | None = None) -> FastAPI:
    app = FastAPI(title="Clash Royale Companion API", version="0.1.0")
    app.state.supercell = supercell or SupercellClient()
    app.state.admission = configured_admission()
    origins = [x.strip() for x in os.environ.get(
        "CRC_CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
    ).split(",") if x.strip()]
    # No wildcard origin; this does not replace authentication/rate limits for public access.
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST"], allow_headers=["Content-Type"])

    @app.middleware("http")
    async def request_id(request: Request, call_next):
        request.state.request_id = f"req_{uuid4().hex[:16]}"
        try:
            peer = request.client.host if request.client else ""
            await request.app.state.admission.admit(
                peer, request.headers.get("X-CRC-Internal-Token", "")
            )
        except AdmissionError as exc:
            response = JSONResponse(
                status_code=exc.status,
                content={"request_id": request.state.request_id,
                         "error": {"code": exc.code, "message": exc.message, "retryable": exc.status == 429}},
            )
            if exc.retry_after is not None:
                response.headers["Retry-After"] = str(exc.retry_after)
        else:
            response = await call_next(request)
        response.headers["X-Request-ID"] = request.state.request_id
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.exception_handler(SupercellError)
    async def supercell_failure(request: Request, exc: SupercellError):
        return JSONResponse(status_code=exc.http_status,
                            content={"request_id": request.state.request_id,
                                     "error": {"code": exc.code, "message": exc.public_message, "retryable": exc.retryable}})

    @app.exception_handler(RequestValidationError)
    async def bad_request(request: Request, exc: RequestValidationError):
        return JSONResponse(status_code=422,
                            content={"request_id": request.state.request_id,
                                     "error": {"code": "INVALID_INPUT", "message": "ورودی درخواست معتبر نیست.", "retryable": False}})

    def parse_tag(raw: str) -> str:
        try:
            return normalize_tag(raw)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="INVALID_PLAYER_TAG") from exc

    @app.exception_handler(HTTPException)
    async def http_failure(request: Request, exc: HTTPException):
        return JSONResponse(status_code=exc.status_code,
                            content={"request_id": request.state.request_id,
                                     "error": {"code": str(exc.detail), "message": "درخواست نامعتبر است.", "retryable": False}})

    @app.get("/api/v1/health/live")
    def live():
        return {"status": "ok"}

    @app.get("/api/v1/health/ready")
    def ready(request: Request):
        if not request.app.state.supercell.configured:
            raise SupercellError("CONFIG_MISSING", "اتصال به Supercell تنظیم نشده است.", 503)
        return {"status": "ok"}

    @app.get("/api/v1/capabilities")
    def capabilities(request: Request):
        """Public, non-secret feature flags only. Does not make API safe for public use."""
        enabled_by_owner = os.environ.get("CRC_LIVE_LOOKUP_ENABLED", "false").lower() == "true"
        enabled = enabled_by_owner and request.app.state.supercell.configured
        return {
            "schema_version": "1.0",
            "live_lookup_enabled": enabled,
            "provider": "supercell" if enabled else None,
            "player_tag_verifies_ownership": False,
            "battle_log_full_history": False,
            "safe_public_exposure": False,
            "message": "Local-only backend. Public deployment requires authentication, rate limits and fixed egress.",
        }

    @app.get("/api/v1/catalog/cards")
    async def cards(request: Request, lang: str = Query(default="fa-IR", pattern="^(fa-IR|en-US)$")):
        raw, provenance = await request.app.state.supercell.cards_record()
        return {"request_id": request.state.request_id,
                "catalog_version": "live-unversioned",
                "items": [card_summary(c) for c in raw["items"] if isinstance(c, dict)],
                "source": provenance}

    @app.get("/api/v1/players/{tag}/snapshot")
    async def player_snapshot(tag: str, request: Request, limit: int = Query(default=25, ge=1, le=25)):
        """One backend call, one official profile request plus (at most) one battle-log request.

        The response is public account data only, not verified ownership.
        A failed Battle Log must not discard a valid profile.
        """
        normalized_tag = parse_tag(tag)
        raw, provenance = await request.app.state.supercell.player_record(normalized_tag)
        result = normalize_profile(raw)
        partial = False
        battle_error_code = None
        battle_provenance = None
        try:
            battle_raw, battle_provenance = await request.app.state.supercell.battles_record(normalized_tag)
            battle_items = [normalize_battle(item) for item in battle_raw[:limit] if isinstance(item, dict)]
        except SupercellError as exc:
            partial = True
            battle_error_code = exc.code
            battle_items = []
        return {
            "request_id": request.state.request_id,
            **result,
            "cards": [card_summary(c) for c in raw.get("cards", []) if isinstance(c, dict)],
            "support_items": [card_summary(c) for c in raw.get("supportCards", []) if isinstance(c, dict)],
            "battles": battle_items,
            "coverage": {"returned_count": len(battle_items), "full_history": False},
            "partial": partial,
            "battles_error_code": battle_error_code,
            "source": provenance,
            "battle_source": battle_provenance,
        }

    @app.get("/api/v1/players/{tag}")
    async def player(tag: str, request: Request):
        raw, provenance = await request.app.state.supercell.player_record(parse_tag(tag))
        return {"request_id": request.state.request_id, **normalize_profile(raw), "source": provenance}

    @app.get("/api/v1/players/{tag}/cards")
    async def player_cards(tag: str, request: Request):
        raw, provenance = await request.app.state.supercell.player_record(parse_tag(tag))
        return {"request_id": request.state.request_id,
                "items": [card_summary(c) for c in raw.get("cards", [])],
                "support_items": [card_summary(c) for c in raw.get("supportCards", [])],
                "source": provenance}

    @app.get("/api/v1/players/{tag}/battles")
    async def battles(tag: str, request: Request, limit: int = Query(default=10, ge=1, le=25)):
        raw, provenance = await request.app.state.supercell.battles_record(parse_tag(tag))
        items = [normalize_battle(r) for r in raw[:limit] if isinstance(r, dict)]
        return {"request_id": request.state.request_id, "items": items,
                "coverage": {"returned_count": len(items), "full_history": False,
                             "note": "Only entries currently available from the official API."},
                "source": provenance}

    @app.post("/api/v1/decks/validate")
    async def validate(payload: DeckInput, request: Request):
        if payload.mode != "standard":
            raise HTTPException(status_code=422, detail="UNSUPPORTED_MODE")
        errors = validate_deck_ids(payload.card_ids)
        if errors:
            return {"request_id": request.state.request_id, "valid": False,
                    "errors": errors, "metrics": None}
        catalog_raw, catalog_source = await request.app.state.supercell.cards_record()
        catalog = {c["id"]: c for c in catalog_raw["items"] if isinstance(c, dict) and "id" in c}
        metrics = deck_metrics(payload.card_ids, catalog)
        return {"request_id": request.state.request_id,
                "valid": not metrics["unknown_card_ids"],
                "errors": [{"code": "UNKNOWN_CARD_OR_COST", "message": "داده کارت کامل نیست."}]
                           if metrics["unknown_card_ids"] else [],
                "metrics": metrics}

    @app.post("/api/v1/analyses")
    async def analyses(payload: AnalysisInput, request: Request):
        # Limited arithmetic-only milestone. All tactical rules deferred pending expert review.
        if payload.deck.mode != "standard" or validate_deck_ids(payload.deck.card_ids):
            raise HTTPException(status_code=422, detail="INVALID_DECK")
        catalog_raw, catalog_source = await request.app.state.supercell.cards_record()
        catalog = {c["id"]: c for c in catalog_raw["items"] if isinstance(c, dict) and "id" in c}
        metrics = deck_metrics(payload.deck.card_ids, catalog)
        return {"request_id": request.state.request_id,
                "engine_version": "arithmetic-only-0.1", "ruleset_version": "draft-unreviewed",
                "facts": {**metrics, "deck_card_ids": payload.deck.card_ids},
                "findings": [], "recommendations": [],
                "source": {"profile_fetched_at": None, "catalog": catalog_source, "stale": False},
                "disclaimer": "فقط داده‌های قابل اندازه‌گیری ارائه می‌شود؛ پیشنهاد تاکتیکی هنوز تأیید نشده است."}

    return app


app = create_app()
