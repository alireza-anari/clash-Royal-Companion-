"""E2E-like private beta gateway tests: signed JWT + quota + mocked Supercell.

No network requests to real Supercell, no live Access app, no real credentials.
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
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from crc_api.beta_gateway import BetaConfig, UnsafeBetaConfiguration, create_beta_app
from crc_api.security.cloudflare_access import AccessVerifier
from crc_api.security.shared_quota import PostgresSharedQuota, QuotaDenied
from crc_api.supercell import SupercellClient


TEAM = "crc-beta-test.cloudflareaccess.com"
HOST = "beta.comp.example"
AUD = "local-beta-app-audience"
SUBJECT = "invited-opaque-subject"
TEST_DSN = os.environ.get("CRC_TEST_POSTGRES_DSN")
QUOTA_SECRET = b"test-only-integration-quota-secret-123456789"
CARD_IDS = [26000010, 26000014, 26000021, 27000000, 26000038, 26000030, 28000000, 28000011]


def fake_settings():
    return BetaConfig(
        hostname=HOST, team_domain=TEAM, audience=AUD,
        allowed_subjects=frozenset({SUBJECT}),
        quota_hmac_secret=QUOTA_SECRET,
        database_dsn="postgresql://demo:local-test@postgres:5432/crc_test",
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
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    key = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(private.public_key()))
    key.update({"kid": "gateway-test-key", "use": "sig", "alg": "RS256"})
    now = int(time.time())

    def token(**changes):
        claims = {"iss": "https://" + TEAM, "aud": AUD, "sub": SUBJECT,
                  "iat": now, "exp": now + 300}
        claims.update(changes)
        return jwt.encode(claims, private, algorithm="RS256",
                          headers={"kid": "gateway-test-key"})

    def certs(request):
        assert request.url.host == TEAM
        assert request.url.path == "/cdn-cgi/access/certs"
        return httpx.Response(200, json={"keys": [key]})

    verifier = AccessVerifier(
        TEAM, AUD, frozenset({SUBJECT}),
        transport=httpx.MockTransport(certs),
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
                      headers={"Cf-Access-Jwt-Assertion": token})


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


def test_missing_invalid_or_uninvited_jwt_never_calls_upstream_or_quota():
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
            ({"Host": "attacker.example", "Cf-Access-Jwt-Assertion": sign()}, 400),
            ({"Origin": "https://evil.example", "Cf-Access-Jwt-Assertion": sign()}, 403),
            ({"Cf-Access-Authenticated-User-Email": "allowed@example.com"}, 401),
            ({"X-Forwarded-For": "127.0.0.1"}, 401),
        ]:
            r = client.get("/api/v1/capabilities", headers=headers)
            assert r.status_code == code
    assert not calls and not quota.calls


def test_valid_access_token_is_reserved_before_supercell_and_returns_snapshot():
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
    quota = PostgresSharedQuota(QUOTA_SECRET, per_member=2, global_budget=3)

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



def test_live_lookup_remains_disabled_with_access_and_database_ready():
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
    monkeypatch.setenv("CRC_BETA_TEAM_DOMAIN", TEAM)
    monkeypatch.setenv("CRC_BETA_AUDIENCE", AUD)
    monkeypatch.setenv("CRC_BETA_ALLOWED_SUBJECTS", SUBJECT)
    monkeypatch.setenv("CRC_BETA_POSTGRES_DSN", config.database_dsn)
    monkeypatch.setenv("CRC_BETA_QUOTA_HMAC_HEX", QUOTA_SECRET.hex())
    monkeypatch.delenv("CRC_BETA_LIVE_LOOKUP_ENABLED", raising=False)
    assert BetaConfig.from_environment().live_lookup_enabled is False
    for value in ("TRUE", "1", "yes", "enabled"):
        monkeypatch.setenv("CRC_BETA_LIVE_LOOKUP_ENABLED", value)
        assert BetaConfig.from_environment().live_lookup_enabled is False
    monkeypatch.setenv("CRC_BETA_LIVE_LOOKUP_ENABLED", "true")
    assert BetaConfig.from_environment().live_lookup_enabled is True
