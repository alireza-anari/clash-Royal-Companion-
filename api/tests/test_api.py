from urllib.parse import unquote

import httpx
from fastapi.testclient import TestClient

from crc_api.main import create_app
from crc_api.supercell import SupercellClient


TOKEN = "in-memory-test-token-do-not-publish"


def fake_upstream(request: httpx.Request) -> httpx.Response:
    assert request.headers.get("Authorization") == f"Bearer {TOKEN}"
    path = unquote(request.url.path)
    if path == "/v1/cards":
        return httpx.Response(200, json={"items": [{"id": i, "name": f"Card {i}", "elixirCost": c}
                                                      for i, c in zip(range(1, 9), [1, 4, 4, 3, 2, 1, 4, 2])]})
    if path == "/v1/players/#TEST123":
        return httpx.Response(200, json={
            "tag": "#TEST123", "name": "Sample", "trophies": 1234, "kingTowerLevel": 10,
            "cards": [{"id": 1, "name": "Example main", "level": 6}],
            "supportCards": [{"id": 159000000, "name": "Tower Princess", "level": 8}],
            "currentDeck": [{"id": i, "name": f"Card {i}"} for i in range(1, 9)],
            "currentDeckSupportCards": [{"id": 159000000, "name": "Tower Princess"}],
        })
    if path == "/v1/players/#TEST123/battlelog":
        return httpx.Response(200, json=[{
            "type": "trail", "deckSelection": "eventDeck", "battleTime": "20261120T120719.000Z",
            "team": [{"tag": "#TEST123", "crowns": 0, "elixirLeaked": 25.8,
                      "kingTowerHitPoints": 0, "princessTowersHitPoints": None,
                      "cards": [{"id": i} for i in range(1, 9)]}],
            "opponent": [{"tag": "#OPP123", "crowns": 3, "elixirLeaked": 1.28,
                          "cards": [{"id": i} for i in range(1, 9)]}],
        }])
    return httpx.Response(404, json={"reason": "notFound"})


def client(transport=fake_upstream):
    app = create_app(SupercellClient(token=TOKEN, transport=httpx.MockTransport(transport)))
    return TestClient(app)


def test_end_to_end_read_only_paths():
    with client() as c:
        assert c.get("/api/v1/health/live").json()["status"] == "ok"
        assert c.get("/api/v1/health/ready").status_code == 200
        cards = c.get("/api/v1/catalog/cards")
        assert cards.status_code == 200 and len(cards.json()["items"]) == 8
        assert cards.headers["X-Request-ID"] == cards.json()["request_id"]
        p = c.get("/api/v1/players/%23TEST123")
        assert p.status_code == 200
        assert p.json()["profile"]["ownership_status"] == "unverified_public_tag"
        assert p.json()["current_deck"]["source"] == "profile_current"
        assert p.json()["current_deck"]["support_card_ids"] == [159000000]
        pc = c.get("/api/v1/players/%23TEST123/cards").json()
        assert len(pc["items"]) == 1 and len(pc["support_items"]) == 1
        b = c.get("/api/v1/players/%23TEST123/battles")
        assert b.status_code == 200
        battle = b.json()["items"][0]
        assert battle["classification"] == "event"
        assert len(battle["participants"]) == 2
        assert battle["participants"][0]["tower_hp"]["princess"] is None
        assert battle["participants"][0]["tower_hp"]["king"] == 0
        assert battle["battle_time"] == "2026-11-20T12:07:19Z"
        assert b.json()["coverage"]["full_history"] is False


def test_deck_analysis_arithmetic_and_structural_errors():
    with client() as c:
        valid = c.post("/api/v1/decks/validate", json={"card_ids": list(range(1, 9))})
        assert valid.status_code == 200 and valid.json()["valid"]
        assert valid.json()["metrics"]["average_elixir"] == 2.625
        bad = c.post("/api/v1/decks/validate", json={"card_ids": [1, 1]})
        assert bad.status_code == 200 and bad.json()["valid"] is False
        a = c.post("/api/v1/analyses", json={"deck": {"card_ids": list(range(1, 9))}})
        assert a.status_code == 200 and a.json()["findings"] == []
        assert a.json()["facts"]["cycle_cost_four_cheapest"] == 6


def test_invalid_tag_never_calls_upstream():
    def no_call(request):
        raise AssertionError("Should reject input before contacting Supercell")
    with client(no_call) as c:
        r = c.get("/api/v1/players/%23A%23B")
        assert r.status_code == 422 and r.json()["error"]["code"] == "INVALID_PLAYER_TAG"


def test_upstream_forbidden_masks_credential():
    def forbidden(request):
        return httpx.Response(403, json={"message": "Invalid authorization"})
    with client(forbidden) as c:
        r = c.get("/api/v1/catalog/cards")
        assert r.status_code == 502
        assert r.json()["error"]["code"] == "UPSTREAM_FORBIDDEN"
        assert TOKEN not in r.text


def test_missing_key_returns_503_without_exposing_details():
    app = create_app(SupercellClient(token=""))
    with TestClient(app) as c:
        assert c.get("/api/v1/health/live").status_code == 200
        assert c.get("/api/v1/health/ready").status_code == 503
        assert c.get("/api/v1/catalog/cards").status_code == 503


def test_upstream_timeout_responds_without_stacktrace():
    def timeout(request):
        raise httpx.ReadTimeout("network timeout")
    with client(timeout) as c:
        r = c.get("/api/v1/catalog/cards")
        assert r.status_code == 504
        assert r.json()["error"]["retryable"] is True
