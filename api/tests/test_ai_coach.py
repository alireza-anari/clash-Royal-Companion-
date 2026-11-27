"""Offline verification of a future opt-in OpenRouter connector; never hits OpenRouter."""
import asyncio
import json

import httpx
import pytest
from pydantic import ValidationError

from crc_api.ai_coach import (
    CoachRequest, OpenRouterCoach, CoachUnavailable,
    PRIMARY_MODEL, FALLBACK_MODEL,
)


def sample():
    return CoachRequest.model_validate({
        "consent_to_external_ai": True,
        "question": "میانگین اکسیر دکم چقدر است؟",
        "deck": {"average_elixir": 3.25, "cycle_cost_four_cheapest": 7},
        "battles": {"filter": "event", "matched_records": 3,
                    "wins": 2, "losses": 1, "draws": 0, "unknown": 0},
    })


def test_structured_evidence_rejects_identifiers_and_raw_logs():
    for bad in [
        {**sample().model_dump(), "player_tag": "#SECRET"},
        {**sample().model_dump(), "battle_log": [{"name": "SECRET"}]},
        {**sample().model_dump(), "deck": {"average_elixir": 3, "name": "SECRET"}},
        {**sample().model_dump(), "battles": {"filter": "event", "matched_records": 1,
                                             "wins": 2, "losses": 0,
                                             "draws": 0, "unknown": 0}},
    ]:
        with pytest.raises(ValidationError):
            CoachRequest.model_validate(bad)


def test_requests_are_only_approved_free_models_and_bounded_evidence():
    seen = []
    def handler(request):
        assert request.url == "https://openrouter.ai/api/v1/chat/completions"
        assert request.headers["authorization"] == "Bearer testing-in-memory"
        body = json.loads(request.content)
        seen.append(body)
        assert body["model"] == PRIMARY_MODEL
        assert body["max_tokens"] <= 450
        assert body["provider"] == {"data_collection": "deny"}
        assert len(body["messages"]) == 2
        assert "#SECRET" not in str(body)
        assert "battleLog" not in str(body)
        return httpx.Response(200, json={"choices": [
            {"message": {"content": "میانگین اکسیر طبق داده ارسالی ۳٫۲۵ است."}}
        ]})
    async def go():
        client = OpenRouterCoach(api_key="testing-in-memory",
                                 transport=httpx.MockTransport(handler))
        return await client.answer(sample())
    result = asyncio.run(go())
    assert result["model"] == PRIMARY_MODEL
    assert "۳٫۲۵" in result["answer"]
    assert result["evidence_status"] == "client_submitted_unverified"
    assert seen[0]["provider"] == {"data_collection": "deny"}
    assert len(seen) == 1


def test_transient_failure_uses_only_free_fallback():
    models = []
    def handler(request):
        body = json.loads(request.content)
        models.append(body["model"])
        if len(models) == 1:
            return httpx.Response(503, json={"error": "transient"})
        return httpx.Response(200, json={"choices": [
            {"message": {"content": "پاسخ آموزشی با اعلام محدودیت داده."}}
        ]})
    async def go():
        return await OpenRouterCoach(
            api_key="testing-in-memory", transport=httpx.MockTransport(handler)
        ).answer(sample())
    answer = asyncio.run(go())
    assert models == [PRIMARY_MODEL, FALLBACK_MODEL]
    assert answer["model"] == FALLBACK_MODEL


def test_rate_limited_provider_never_tries_second_model():
    calls = []
    def handler(request):
        calls.append(1)
        return httpx.Response(429, json={"error": {"message": "private key"}})
    async def go():
        await OpenRouterCoach(
            api_key="testing-in-memory", transport=httpx.MockTransport(handler)
        ).answer(sample())
    with pytest.raises(CoachUnavailable) as err:
        asyncio.run(go())
    assert len(calls) == 1
    assert err.value.code == "AI_PROVIDER_RATE_LIMIT"
    assert "private key" not in str(err.value)


def test_disabled_or_missing_key_blocks_network():
    def handler(request):
        raise AssertionError("Never call provider when not configured")
    async def go():
        await OpenRouterCoach(api_key="", transport=httpx.MockTransport(handler)).answer(sample())
    with pytest.raises(CoachUnavailable) as err:
        asyncio.run(go())
    assert err.value.code == "AI_DISABLED"


def test_plain_text_is_not_enough_to_claim_video_or_full_match_analysis():
    async def go():
        payload = CoachRequest.model_validate({
            "consent_to_external_ai": True,
            "question": "ویدیو ریپلی من را تحلیل کن",
        })
        await OpenRouterCoach(api_key="testing-in-memory", transport=httpx.MockTransport(
            lambda request: (_ for _ in ()).throw(AssertionError("no video calls"))
        )).answer(payload)
    with pytest.raises(CoachUnavailable) as err:
        asyncio.run(go())
    assert err.value.code == "REPLAY_NOT_SUPPORTED"
