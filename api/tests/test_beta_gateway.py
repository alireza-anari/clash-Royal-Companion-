"""E2E-like private beta gateway tests: signed Worker assertion + quota + mocked Supercell.

No network requests to real Supercell, no live identity provider, no real credentials.
"""
from __future__ import annotations

import json
from dataclasses import replace
import os
import time
from urllib.parse import unquote

import httpx
import jwt
import pytest
from fastapi.testclient import TestClient

from crc_api.beta_gateway import BetaConfig, UnsafeBetaConfiguration, create_beta_app
from crc_api.security.worker_assertion import WorkerAssertionVerifier
from crc_api.security.shared_quota import PostgresSharedQuota, QuotaDenied
from crc_api.supercell import SupercellClient


ISSUER = "https://" + HOST
HOST = "beta.comp.example"
AUD = "local-beta-app-audience"
SUBJECT = "invited-opaque-subject"
TEST_DSN = os.environ.get("CRC_TEST_POSTGRES_DSN")
QUOTA_SECRET = b"test-only-integration-quota-secret-123456789"
WORKER_SECRET = b"test-only-worker-assertion-secret-123456789"
CARD_IDS = [26000010, 26000014, 26000021, 27000000, 26000038, 26000030, 28000000, 28000011]


def fake_settings():
    return BetaConfig(
        hostname=HOST, auth_issuer=ISSUER, audience=AUD,
        allowed_subjects=frozenset({SUBJECT}),
        quota_hmac_secret=QUOTA_SECRET,
        worker_assertion_secret=WORKER_SECRET,
        database_dsn="postgresql://demo:local-test@postgres:5432/crc_test?sslmode=verify-full",
        live_lookup_enabled=True,
    )


class MockConn:
    pass


class MockPool:
    def acquire(self):
        return self

    async def __aenter__(self):
        return MockConn()

    async def __aexit__(self, *args):
        return None

    async def close(self):
        pass


async def fake_pool(_):
    return MockPool()


class MockQuota:
    def __init__(self, error=None):
        self.error = error
        self.calls = []

    async def reserve(self, connection, verified_subject):
        self.calls.append(verified_subject)
        if self.error:
            raise self.error
        return {"member_count": len(self.calls), "global_count": len(self.calls)}


def credentials():
    now = int(time.time())

    def token(**changes):
        claims = {"iss": ISSUER, "aud": AUD, "sub": SUBJECT,
                  "iat": now, "exp": now + 60, "jti": "test-token-identifier-1234"}
        claims.update(changes)
        return jwt.encode(claims, WORKER_SECRET, algorithm="HS256")

    verifier = WorkerAssertionVerifier(
        ISSUER, AUD, frozenset({SUBJECT}), WORKER_SECRET,
    )
    return verifier, token


def upstream(calls):
    def transport(request: httpx.Request):
        calls.append(unquote(request.url.path))
        assert request.headers["Authorization"] == "Bearer mock-supercell-key"
        url = unquote(request.url.path)
        if url == "/v1/players/#TEST123":
            return httpx.Response(200, json={
                "tag": "#TEST123", "name": "Example",
                "trophies": 1200, "cards": [
                    {"id": v, "name": f"Card {v}", "elixirCost": 3}
                    for v in CARD_IDS
                ],
                "supportCards": [{"id": 159000000, "name": "Tower Princess"}],
                "currentDeck": [
                    {"id": v, "name": f"Card {v}"} for v in CARD_IDS
                ]
            })
        if url == "/v1/players/#TEST123/battlelog":
            return httpx.Response(200, json=[{
                "type": "trail", "deckSelection": "eventDeck",
                "battleTime": "20261120T120719.000Z",
                "team": [{"tag": "#TEST123", "name": "Example", "crowns": 0,
                          "cards": [{"id": v} for v in CARD_IDS]}],
                "opponent": [{"tag": "#RIVAL123", "name": "Rival", "crowns": 3,
                              "cards": [{"id": v} for v in CARD_IDS]}]
            }])
        if url == "/v1/cards":
            return httpx.Response(200, json={"items": [{
                "id": v, "name": f"Card {v}", "elixirCost": 3
            } for v in CARD_IDS]})
        return httpx.Response(404, json={"reason": "notFound"})
    return httpx.MockTransport(transport)


def build_app(verifier, quota, calls, pool_factory=fake_pool):
    return create_beta_app(
        config=fake_settings(), verifier=verifier, quota=quota,
        supercell=SupercellClient(token="mock-supercell-key", transport=upstream(calls)),
        pool_factory=pool_factory,
    )


def request(client, token):
    return client.get("/api/v1/players/%23TEST123/snapshot?limit=25",
                      headers={"X-CRC-Worker-Assertion": token})


def test_separate_beta_requires_explicit_configuration_and_real_provider(monkeypatch):
    monkeypatch.delenv("CRC_BETA_RUNTIME_GATE", raising=False)
    with pytest.raises(UnsafeBetaConfiguration, match="approved"):
        create_beta_app()
    with pytest.raises(UnsafeBetaConfiguration, match="not configured"):
        create_beta_app(config=fake_settings(), supercell=SupercellClient(token=""))
    # Local implementation cannot start in remote mode, regardless of beta code.
    from crc_api.main import create_app
    monkeypatch.setenv("CRC_RUNTIME_MODE", "production")
    with pytest.raises(RuntimeError, match="Only local backend runtime"):
        create_app(SupercellClient(token="mock-supercell-key"))


def test_missing_invalid_or_uninvited_worker_assertion_never_calls_upstream_or_quota():
    verifier, sign = credentials()
    quota = MockQuota()
    calls = []
    app = build_app(verifier, quota, calls)
    with TestClient(app, base_url="https://" + HOST) as client:
        missing = client.get("/api/v1/capabilities")
        assert missing.status_code == 401
        bad = request(client, sign(aud="wrong-app"))
        assert bad.status_code == 403
        denied = request(client, sign(sub="uninvited-subject"))
        assert denied.status_code == 403
        assert missing.headers["Cache-Control"] == "no-store"
    assert not calls and not quota.calls


def test_host_origin_and_spoofed_headers_do_not_bypass_authentication():
    verifier, sign = credentials()
    quota = MockQuota()
    calls = []
    app = build_app(verifier, quota, calls)
    with TestClient(app, base_url="https://" + HOST) as client:
        for headers, code in [
            ({"Host": "attacker.example", "Cf-Worker auth-Jwt-Assertion": sign()}, 400),
            ({"Origin": "https://evil.example", "Cf-Access-Jwt-Assertion": sign()}, 403),
            ({"Cf-Access-Authenticated-User-Email": "allowed@example.com"}, 401),
            ({"X-Forwarded-For": "127.0.0.1"}, 401),
        ]:
            r = client.get("/api/v1/capabilities", headers=headers)
            assert r.status_code == code
    assert not calls and not quota.calls


def test_valid_worker_assertion_is_reserved_before_supercell_and_returns_snapshot():
    verifier, sign = credentials()
    quota = MockQuota()
    calls = []
    app = build_app(verifier, quota, calls)
    with TestClient(app, base_url="https://" + HOST) as client:
        r = request(client, sign())
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["profile"]["tag"] == "#TEST123"
        assert data["profile"]["ownership_status"] == "unverified_public_tag"
        assert len(data["cards"]) == 8
        assert data["partial"] is False
        assert data["coverage"]["full_history"] is False
        assert data["battles"][0]["classification"] == "event"
        assert "mock-supercell-key" not in r.text
        assert "invited-opaque-subject" not in r.text
    assert quota.calls == [SUBJECT]
    assert calls == ["/v1/players/#TEST123", "/v1/players/#TEST123/battlelog"]


def test_quota_denial_rejects_before_any_supercell_lookup():
    verifier, sign = credentials()
    quota = MockQuota(QuotaDenied("GLOBAL_QUOTA_EXCEEDED", 19))
    calls = []
    app = build_app(verifier, quota, calls)
    with TestClient(app, base_url="https://" + HOST) as client:
        r = request(client, sign())
        assert r.status_code == 429
        assert r.headers["Retry-After"] == "19"
        assert r.json()["error"]["code"] == "GLOBAL_QUOTA_EXCEEDED"
    assert not calls


def test_database_unavailable_fails_closed_without_provider_calls():
    verifier, sign = credentials()
    quota = MockQuota()
    calls = []

    class BrokenPool:
        def acquire(self):
            raise RuntimeError("private-db-connection-and-password")
        async def close(self):
            pass

    async def broken_factory(_):
        return BrokenPool()

    app = build_app(verifier, quota, calls, pool_factory=broken_factory)
    with TestClient(app, base_url="https://" + HOST) as client:
        r = request(client, sign())
        assert r.status_code == 503
        assert r.json()["error"]["code"] == "BETA_ADMISSION_UNAVAILABLE"
        assert "private-db" not in r.text
    assert not quota.calls and not calls


def test_status_and_unknown_paths_require_identity():
    verifier, sign = credentials()
    quota = MockQuota()
    calls = []
    app = build_app(verifier, quota, calls)
    with TestClient(app, base_url="https://" + HOST) as client:
        for path in ["/api/v1/capabilities", "/api/v1/catalog/cards", "/docs", "/nothing"]:
            assert client.get(path).status_code == 401
        enabled = client.get("/api/v1/capabilities",
                             headers={"Cf-Access-Jwt-Assertion": sign()})
        assert enabled.status_code == 200
        assert enabled.json()["live_lookup_enabled"] is True
    assert not calls


@pytest.mark.skipif(not TEST_DSN, reason="Disposable PostgreSQL CI database required.")
def test_real_postgres_rejects_third_request_at_shared_member_quota():
    import asyncpg
    verifier, sign = credentials()
    calls = []
    # Freeze one UTC quota bucket across all HTTP calls. Otherwise a CI run
    # crossing the wall-clock minute boundary can legitimately admit the third
    # request into a new bucket, causing a flaky false failure.
    from datetime import datetime, timezone
    class FixedBucketQuota(PostgresSharedQuota):
        async def reserve(self, connection, verified_subject, *, now=None):
            return await super().reserve(
                connection, verified_subject,
                now=datetime(2026, 11, 20, 14, 15, 25, tzinfo=timezone.utc),
            )
    quota = FixedBucketQuota(QUOTA_SECRET, per_member=2, global_budget=3)

    async def postgres_pool(_):
        pool = await asyncpg.create_pool(TEST_DSN, min_size=1, max_size=3)
        async with pool.acquire() as conn:
            from pathlib import Path
            script = Path(__file__).resolve().parents[1] / "migrations" / "DRAFT_0001_gateway_quota.sql"
            await conn.execute(script.read_text())
            await conn.execute("DELETE FROM gateway_quota_windows")
        return pool

    app = build_app(verifier, quota, calls, pool_factory=postgres_pool)
    with TestClient(app, base_url="https://" + HOST) as client:
        token = sign()
        for _ in range(2):
            r = client.get("/api/v1/capabilities",
                           headers={"Cf-Access-Jwt-Assertion": token})
            assert r.status_code == 200, r.text
        blocked = client.get("/api/v1/catalog/cards",
                             headers={"Cf-Access-Jwt-Assertion": token})
        assert blocked.status_code == 429
        assert blocked.json()["error"]["code"] == "MEMBER_QUOTA_EXCEEDED"
        assert int(blocked.headers["Retry-After"]) >= 1
    assert not calls



def test_live_lookup_remains_disabled_with_worker_auth_and_database_ready():
    verifier, sign = credentials()
    calls = []
    quota = MockQuota()
    configuration = replace(fake_settings(), live_lookup_enabled=False)
    # Deliberately no Supercell API key. A protected beta can be deployed in
    # read-only preparation mode, without silently enabling upstream calls.
    app = create_beta_app(
        config=configuration, verifier=verifier, quota=quota,
        supercell=SupercellClient(token="", transport=upstream(calls)),
        pool_factory=fake_pool,
    )
    with TestClient(app, base_url="https://" + HOST) as client:
        headers = {"Cf-Access-Jwt-Assertion": sign()}
        c = client.get("/api/v1/capabilities", headers=headers)
        assert c.status_code == 200
        assert c.json()["live_lookup_enabled"] is False
        for path in ["/api/v1/catalog/cards",
                     "/api/v1/players/%23TEST123/snapshot?limit=25"]:
            response = client.get(path, headers=headers)
            assert response.status_code == 503
            assert response.json()["error"]["code"] == "BETA_LIVE_LOOKUP_DISABLED"
    assert not calls
    assert len(quota.calls) == 3  # Auth and quotas still applied.


def test_live_lookup_switch_requires_exact_explicit_opt_in(monkeypatch):
    config = fake_settings()
    monkeypatch.setenv("CRC_BETA_RUNTIME_GATE", "private-beta-explicit-owner-approval")
    monkeypatch.setenv("CRC_BETA_HOST", HOST)
    monkeypatch.setenv("CRC_BETA_AUTH_ISSUER", ISSUER)
    monkeypatch.setenv("CRC_BETA_AUTH_AUDIENCE", AUD)
    monkeypatch.setenv("CRC_BETA_ALLOWED_SUBJECTS", SUBJECT)
    monkeypatch.setenv("CRC_BETA_POSTGRES_DSN", config.database_dsn)
    monkeypatch.setenv("CRC_BETA_QUOTA_HMAC_HEX", QUOTA_SECRET.hex())
    monkeypatch.setenv("CRC_BETA_WORKER_ASSERTION_HMAC_HEX", WORKER_SECRET.hex())
    monkeypatch.delenv("CRC_BETA_LIVE_LOOKUP_ENABLED", raising=False)
    assert BetaConfig.from_environment().live_lookup_enabled is False
    for value in ("TRUE", "1", "yes", "enabled"):
        monkeypatch.setenv("CRC_BETA_LIVE_LOOKUP_ENABLED", value)
        assert BetaConfig.from_environment().live_lookup_enabled is False
    monkeypatch.setenv("CRC_BETA_LIVE_LOOKUP_ENABLED", "true")
    assert BetaConfig.from_environment().live_lookup_enabled is True



@pytest.mark.parametrize("suffix", [
    "", "?sslmode=disable", "?sslmode=require", "?sslmode=verify-ca",
    "?sslmode=verify-full&sslmode=disable",
])
def test_beta_database_requires_hostname_verified_tls(suffix):
    invalid = replace(
        fake_settings(),
        database_dsn="postgresql://demo:local-test@db.example:5432/crc_test" + suffix,
    )
    with pytest.raises(UnsafeBetaConfiguration, match="database is not configured"):
        invalid.validate()


def test_beta_database_accepts_explicit_verify_full():
    settings = fake_settings()
    settings.validate()
    assert settings.live_lookup_enabled is True


def test_authenticated_readiness_confirms_worker_assertion_and_quota_without_supercell():
    verifier, sign = credentials()
    quota = MockQuota()
    calls = []
    app = build_app(verifier, quota, calls)
    with TestClient(app, base_url="https://" + HOST) as client:
        missing = client.get("/api/v1/health/ready")
        assert missing.status_code == 401
        ready = client.get("/api/v1/health/ready",
                           headers={"Cf-Access-Jwt-Assertion": sign()})
        assert ready.status_code == 200
        result = ready.json()
        assert result["status"] == "ready_for_authenticated_requests"
        assert result["checks"] == {"worker_assertion": "verified", "shared_quota": "reserved"}
        assert result["live_lookup_enabled"] is True
        assert result["supercell_connectivity_checked"] is False
        assert result["full_production_readiness"] is False
        assert ready.headers["Cache-Control"] == "no-store"
    assert quota.calls == [SUBJECT]
    assert calls == []


def test_readiness_fails_closed_when_shared_quota_unavailable():
    verifier, sign = credentials()
    calls = []
    quota = MockQuota(QuotaDenied("MEMBER_QUOTA_EXCEEDED", 17))
    app = build_app(verifier, quota, calls)
    with TestClient(app, base_url="https://" + HOST) as client:
        res = client.get("/api/v1/health/ready",
                         headers={"Cf-Access-Jwt-Assertion": sign()})
        assert res.status_code == 429
        assert res.headers["Retry-After"] == "17"
    assert calls == []


def test_disabled_beta_readiness_reports_disabled_without_upstream():
    verifier, sign = credentials()
    calls = []
    settings = replace(fake_settings(), live_lookup_enabled=False)
    app = create_beta_app(
        config=settings, verifier=verifier, quota=MockQuota(),
        supercell=SupercellClient(token="", transport=upstream(calls)),
        pool_factory=fake_pool,
    )
    with TestClient(app, base_url="https://" + HOST) as client:
        res = client.get("/api/v1/health/ready",
                         headers={"Cf-Access-Jwt-Assertion": sign()})
        assert res.status_code == 200
        assert res.json()["live_lookup_enabled"] is False
        assert res.json()["supercell_connectivity_checked"] is False
    assert calls == []


def test_private_ai_chat_opt_in_and_daily_budget(monkeypatch):
    """No prompt may reach provider without a verified invite session, consent and daily budget."""
    from crc_api.ai_daily_budget import AIDailyBudgetExceeded

    class MockAI:
        configured = True
        def __init__(self):
            self.calls = []
        async def answer(self, payload):
            self.calls.append(payload)
            return {"model": "google/gemma-4-31b-it:free",
                    "answer": "این فقط داده ارسالی کاربر است.",
                    "evidence_status": "client_submitted_unverified"}

    class AIBudget:
        def __init__(self):
            self.calls = []
            self.denied = False
        async def reserve(self, connection, subject):
            self.calls.append(subject)
            if self.denied:
                raise AIDailyBudgetExceeded(3700)

    monkeypatch.setenv("CRC_BETA_AI_ENABLED", "true")
    verifier, sign = credentials()
    ai, daily = MockAI(), AIBudget()
    calls = []
    app = create_beta_app(
        config=fake_settings(), verifier=verifier, quota=MockQuota(),
        supercell=SupercellClient(token="mock-supercell-key", transport=upstream(calls)),
        pool_factory=fake_pool, ai_client=ai, ai_budget=daily,
    )
    payload = {"consent_to_external_ai": True,
               "question": "اکسیر دک من چقدر است؟",
               "deck": {"average_elixir": 3.1}}
    with TestClient(app, base_url="https://" + HOST) as client:
        headers = {"Cf-Access-Jwt-Assertion": sign()}
        assert client.post("/api/v1/coach/chat", json=payload).status_code == 401
        assert client.post("/api/v1/coach/chat", headers=headers,
                           json={**payload, "consent_to_external_ai": False}).status_code == 403
        bad = client.post("/api/v1/coach/chat", headers=headers,
                          json={**payload, "player_tag": "#DONT_SEND"})
        assert bad.status_code == 422
        enabled = client.get("/api/v1/capabilities", headers=headers).json()
        assert enabled["ai_coach_enabled"] is True
        result = client.post("/api/v1/coach/chat", headers=headers, json=payload)
        assert result.status_code == 200
        assert result.json()["external_inference"] is True
        assert result.json()["replay_analyzed"] is False
        assert result.json()["model"] == "google/gemma-4-31b-it:free"
        assert len(ai.calls) == 1
        assert daily.calls == [SUBJECT]
        daily.denied = True
        denied = client.post("/api/v1/coach/chat", headers=headers, json=payload)
        assert denied.status_code == 429
        assert denied.headers["Retry-After"] == "3700"
        assert denied.json()["error"]["code"] == "AI_DAILY_BUDGET_EXCEEDED"
    assert len(ai.calls) == 1
    assert calls == []


def test_ai_is_disabled_and_budget_failure_fails_closed(monkeypatch):
    class MockAI:
        configured = True
        def __init__(self):
            self.calls = 0
        async def answer(self, payload):
            self.calls += 1
            return {"answer": "should-not-return"}

    class BrokenBudget:
        async def reserve(self, connection, subject):
            raise RuntimeError("private-postgres-ai-budget-unavailable")

    verifier, sign = credentials()
    ai = MockAI()
    payload = {"consent_to_external_ai": True, "question": "نکات دک چیست؟"}
    kwargs = dict(config=fake_settings(), verifier=verifier, quota=MockQuota(),
                  supercell=SupercellClient(token="mock-supercell-key",
                                            transport=upstream([])),
                  pool_factory=fake_pool, ai_client=ai, ai_budget=BrokenBudget())
    monkeypatch.delenv("CRC_BETA_AI_ENABLED", raising=False)
    with TestClient(create_beta_app(**kwargs), base_url="https://" + HOST) as client:
        r = client.post("/api/v1/coach/chat",
                        headers={"Cf-Access-Jwt-Assertion": sign()}, json=payload)
        assert r.status_code == 503
        assert r.json()["error"]["code"] == "AI_COACH_DISABLED"
        assert client.get("/api/v1/capabilities",
                          headers={"Cf-Access-Jwt-Assertion": sign()}).json()["ai_coach_enabled"] is False
    monkeypatch.setenv("CRC_BETA_AI_ENABLED", "true")
    with TestClient(create_beta_app(**kwargs), base_url="https://" + HOST) as client:
        r = client.post("/api/v1/coach/chat",
                        headers={"Cf-Access-Jwt-Assertion": sign()}, json=payload)
        assert r.status_code == 503
        assert r.json()["error"]["code"] == "AI_BUDGET_UNAVAILABLE"
        assert "private-postgres" not in r.text
    assert ai.calls == 0


def test_beta_openrouter_ssm_loading_requires_explicit_switch(monkeypatch):
    """No AWS SSM reads until opt-in; enabled path gets only approved parameter."""
    import crc_api.beta_gateway as module
    from crc_api.ssm_secret import PARAMETER_NAME
    calls = []
    def fake_ssm(*, enabled, parameter):
        calls.append((enabled, parameter))
        return "sk-or-v1-" + "a" * 48

    monkeypatch.setattr(module, "load_openrouter_key_from_ssm", fake_ssm, raising=False)
    monkeypatch.setenv("CRC_OPENROUTER_SSM_PARAMETER", PARAMETER_NAME)
    monkeypatch.setenv("OPENROUTER_API_KEY", "THIS_ENV_KEY_SHOULD_BE_IGNORED")
    monkeypatch.setenv("CRC_BETA_AI_ENABLED", "false")
    settings = fake_settings()
    verifier, _sign = credentials()
    kwargs = dict(
        config=settings, verifier=verifier, quota=MockQuota(),
        supercell=SupercellClient(token="mock-supercell-key", transport=upstream([])),
        pool_factory=fake_pool,
    )
    disabled = create_beta_app(**kwargs)
    assert disabled.state.ai_chat.configured is False
    assert calls == []
    monkeypatch.setenv("CRC_BETA_AI_ENABLED", "true")
    enabled = create_beta_app(**kwargs)
    assert enabled.state.ai_chat.configured is True
    assert calls == [(True, PARAMETER_NAME)]


def test_ai_ssm_config_failure_never_starts_enabled_beta(monkeypatch):
    from crc_api.ssm_secret import PARAMETER_NAME, SSMSecretUnavailable
    import crc_api.beta_gateway as module

    monkeypatch.setenv("CRC_BETA_AI_ENABLED", "true")
    monkeypatch.setenv("CRC_OPENROUTER_SSM_PARAMETER", PARAMETER_NAME)

    def fail(*, enabled, parameter):
        raise SSMSecretUnavailable()

    monkeypatch.setattr(module, "load_openrouter_key_from_ssm", fail, raising=False)
    verifier, _sign = credentials()
    with pytest.raises(UnsafeBetaConfiguration, match="AI credential"):
        create_beta_app(
            config=fake_settings(), verifier=verifier, quota=MockQuota(),
            supercell=SupercellClient(token="mock-supercell-key", transport=upstream([])),
            pool_factory=fake_pool,
        )
