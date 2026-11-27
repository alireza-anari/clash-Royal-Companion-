from urllib.parse import unquote

import httpx
from fastapi.testclient import TestClient

from crc_api.main import create_app
from crc_api.supercell import SupercellClient


TOKEN = "private-test-token-never-use-outside-tests"


def upstream(calls, fail_battle=False):
    def fake(request: httpx.Request) -> httpx.Response:
        calls.append(unquote(request.url.path))
        assert request.headers.get("Authorization") == f"Bearer {TOKEN}"
        path = unquote(request.url.path)
        if path == "/v1/players/#TEST123":
            return httpx.Response(200, json={
                "tag": "#TEST123", "name": "Sample", "trophies": 1450,
                "cards": [{"id": i, "name": f"Card {i}", "elixirCost": i} for i in range(1, 9)],
                "supportCards": [{"id": 159000000, "name": "Tower Princess"}],
                "currentDeck": [{"id": i, "name": f"Card {i}"} for i in range(1, 9)],
                "currentDeckSupportCards": [{"id": 159000000, "name": "Tower Princess"}],
            })
        if path == "/v1/players/#TEST123/battlelog":
            if fail_battle:
                return httpx.Response(503, json={"reason": "maintenance"})
            return httpx.Response(200, json=[{
                "type": "trail", "deckSelection": "eventDeck",
                "battleTime": "20261120T120719.000Z",
                "team": [{"tag": "#TEST123", "name": "Sample", "crowns": 0,
                          "elixirLeaked": 25.8, "cards": [{"id": i} for i in range(1, 9)]}],
                "opponent": [{"tag": "#OTHER123", "name": "Rival", "crowns": 3,
                              "cards": [{"id": i} for i in range(1, 9)]}],
            }])
        return httpx.Response(404, json={"reason": "notFound"})
    return fake


def test_snapshot_uses_one_profile_and_one_battle_call_without_leaking_secret():
    calls = []
    api = SupercellClient(token=TOKEN, transport=httpx.MockTransport(upstream(calls)))
    with TestClient(create_app(api)) as client:
        r = client.get("/api/v1/players/%23TEST123/snapshot?limit=25")
        assert r.status_code == 200
        data = r.json()
        assert data["profile"]["tag"] == "#TEST123"
        assert data["profile"]["ownership_status"] == "unverified_public_tag"
        assert len(data["cards"]) == 8
        assert len(data["support_items"]) == 1
        assert data["current_deck"]["support_card_ids"] == [159000000]
        assert data["partial"] is False
        assert data["battles_error_code"] is None
        assert data["coverage"]["full_history"] is False
        assert data["battles"][0]["classification"] == "event"
        assert data["battles"][0]["participants"][0]["name"] == "Sample"
        assert data["battles"][0]["participants"][0]["elixir_leaked"] == 25.8
        assert TOKEN not in r.text
    assert calls == ["/v1/players/#TEST123", "/v1/players/#TEST123/battlelog"]


def test_snapshot_battle_error_preserves_profile_and_reports_partial():
    calls = []
    api = SupercellClient(token=TOKEN, transport=httpx.MockTransport(upstream(calls, fail_battle=True)))
    with TestClient(create_app(api)) as client:
        r = client.get("/api/v1/players/%23TEST123/snapshot")
        assert r.status_code == 200
        data = r.json()
        assert data["profile"]["tag"] == "#TEST123"
        assert len(data["cards"]) == 8
        assert data["battles"] == []
        assert data["coverage"]["full_history"] is False
        assert data["partial"] is True
        assert data["battles_error_code"] == "UPSTREAM_UNAVAILABLE"
        assert TOKEN not in r.text


def test_snapshot_tag_and_limit_validation_before_upstream():
    def no_call(request):
        raise AssertionError("Invalid snapshot inputs must be rejected before Supercell API")
    api = SupercellClient(token=TOKEN, transport=httpx.MockTransport(no_call))
    with TestClient(create_app(api)) as client:
        assert client.get("/api/v1/players/%23BAD%23TAG/snapshot").status_code == 422
        assert client.get("/api/v1/players/%23TEST123/snapshot?limit=26").status_code == 422
